# CLAUDE.md — MCM / PermitIQ

IEPS(통합환경허가) 데이터 수집·파싱 + 계약/사업장 관리 모노레포. 상세 도메인 설명은 [README.md](README.md) 참고.
이 문서는 Claude Code가 이 저장소에서 작업할 때의 **운영 규칙**이다. (사람이 읽는 문서는 README, AI 작업 규칙은 여기)

## 브랜치·배포 운영 규칙 (모든 세션 공통) ★
여러 Claude 세션이 각자 브랜치에서 작업하다 **다른 브랜치 기능이 빠진 이미지가 배포되는 사고가 2회**(2026-08-26·08-31) 있었다. 어느 세션이든 다음을 지킨다.
- **작업 시작 전**: `git fetch origin` 후 원격 브랜치 상황을 확인하고, **최신 main(또는 진행 중인 통합 브랜치)에서 분기**한다. 오래된 분기점 위에 새 작업을 쌓지 않는다.
- **배포는 반드시 `infra/aws/ops/staging-deploy-next.ps1` 로**: 원격 `claude/*`·`main` 커밋 누락을 검사하는 **갈라진 배포 가드**가 들어 있다. 경고가 뜨면 배포를 멈추고 해당 브랜치를 먼저 머지한 뒤 배포한다(`-Force` 남용 금지).
- **마이그레이션 번호**: 갈래별 중복 사고로 **200~210 이 소진**됐다 — 신규는 **211부터**, 번호 확정 전 `git fetch` 후 원격 전 브랜치의 `infra/aws/` 를 확인한다. DB 적용은 `infra/aws/ops/staging-apply-migrations.ps1 -Files <파일들>`.
- **main 수렴**: 통합 PR([#1](https://github.com/nagashino2014/MCM/pull/1))이 머지된 뒤에는 세션 브랜치를 main 에서 재분기한다. 통합 브랜치에 기능이 있는데 자기 브랜치에 없다면, 삭제하지 말고 머지로 가져온다.

## 언어 / 출력
- **사고 과정(thinking/reasoning) 로그는 기본적으로 한국어로 작성한다.** 사용자가 한국어 화자라, 로그가 길어질수록 영어 reasoning은 가독성이 크게 떨어진다.
- 단, **코드·식별자·파일경로·명령어·에러 메시지·기술 고유명사는 영어 원문 그대로** 둔다(번역하지 말 것).
- 사용자 대면 답변도 한국어 기본.

## 서브시스템 (모노레포)
| 경로 | 역할 | 스택 |
|---|---|---|
| `frontend/` | 웹 앱 (UI + API 라우트) | Next.js 15 App Router, React 19, TypeScript, Tailwind, lucide-react, ApexCharts, next-auth v5. DB(`pg`)·S3·SQS 직접 호출 |
| `backend/` | OCR·파싱 코어 API | FastAPI (Python 3.11), `uvicorn app.main:app` (포트 8001), PaddleOCR 등 |
| `scraper/` | IEPS 게시판 스크래퍼 = ECS **worker** | Node + Playwright (`npm run worker:aws`) |
| `infra/aws/` | 인프라 | Terraform (ECS Fargate·ECR·RDS·S3·SQS) + 멱등 SQL 마이그레이션 `NNN_*.sql` |
| `data/` | IEPS 원본/추출 PDF, KSIC 코드 | **약 14GB — 열지 말 것** (아래 컨텍스트 위생) |
| `scripts/` | 마이그레이션·진단용 Python 스크립트 | — |

## 자주 쓰는 명령
- **프론트**: `cd frontend && npm run dev` · `npm run build` · `npm run lint`
  - 타입 체크: `cd frontend && npx tsc --noEmit` (⚠ 아래 "디버깅" 주의 참고)
- **백엔드**: `cd backend && uvicorn app.main:app --reload --port 8001` · 테스트 `cd backend && python -m pytest`
- **스크래퍼**: `cd scraper && npm run collect` (수집) · `npm run worker:aws` (워커)
> 셸은 PowerShell(또는 git-bash). 명령은 해당 서브디렉터리에서 실행한다.

## 코드 작성 규칙 (일관성)
- **주변 코드를 따른다**: 같은 디렉터리/파일의 네이밍·들여쓰기·주석 밀도·import 순서·패턴을 그대로 맞춘다. 새 라이브러리·새 패턴을 임의 도입하지 않는다.
- **언어**: 사용자 대면 텍스트·주석·커밋 메시지는 기존 관례대로 한국어 위주, 식별자는 영어.
- **프론트 import 별칭**: `@/...` (= `frontend/`). 아이콘은 `lucide-react` 단일 세트.
- **DB 변경**은 `infra/aws/NNN_*.sql` 멱등 마이그레이션으로 추가(기존 파일 수정 금지, 다음 번호로 신규 작성).
- **수정 범위 최소화**: 요청과 무관한 리팩터링·포맷팅을 끼워 넣지 않는다.

## UI 규칙 — Modernize(cdash)가 메인 컨셉 ★
이 앱의 모든 UI는 **Modernize 어드민 UI 키트를 재현한 `cdash` 디자인 시스템**을 따른다. **신규/수정 UI는 반드시 이 컨셉으로 작성**한다.
- **권위 있는 전체 규칙**: [`.cursor/rules/ui-modernize.mdc`](.cursor/rules/ui-modernize.mdc) — Cursor 전용 파일이지만 **Claude Code도 UI 작업 시 이 파일을 읽고 따른다**(이 CLAUDE.md가 그 적용을 명시함).
- **라이브 레퍼런스 구현**: `frontend/components/cdash/`(토큰 `cdash.css`, `useCdashTheme`, `CdThemeToggle`, `CdPageHeader`) + `frontend/app/(app)/contracts/{dashboard,billing}`, 그리고 마이그레이션 완료된 `facilities`·`data`·`contracts` 화면.
- **핵심 원칙(요약)**:
  - 토큰은 `cdash.css`의 `--cd-*` CSS 변수(라이트/다크 듀얼). primary = 블루 `#5D87FF`. 폰트 Plus Jakarta Sans + Pretendard.
  - 페이지 루트: `<div className="cdash cd-fields-white ..." data-theme={theme}>` + `CdPageHeader`. 테마는 `useCdashTheme`(localStorage `cdash-theme` 공유).
  - **포털(`createPortal`) 모달**은 `.cdash` 밖이라 토큰이 안 풀린다 → 루트에 `cdash-vars`(+`cd-fields-white`) + `data-theme` 부여.
  - **박스/항목은 배경 채움 대신 윤곽선(`border cd-border-c`) 기본**, 선택·강조 요소만 `cd-tint-primary`/`cd-fill-primary`로 채운다. 입력류는 `cd-fields-white` 스코프에서 흰색.
  - **날짜 입력은 네이티브 `<input type="date">` 금지**. `CdDateInput`(`components/cdash`)을 쓴다 —
    `YYYYMMDD` 8자리를 이어 치면 `2026-07-01` 로 자동 완성된다(값은 `YYYY-MM-DD` 문자열 그대로).
    새로 날짜 입력을 놓을 때도, 기존 화면을 손볼 때도 이 컴포넌트로 통일한다.
  - 구식 잔재 금지: `glass-*`, 녹색 `bg-primary`(#16A34A), `text-stone-*`, gradient 히어로 등 → cd 토큰으로.
  - `dashboard.css`/`billing.css`와 `cdash.css`가 공유하는 클래스는 값이 동일해야 한다(분기 금지). 공유 컴포넌트(예: `FacilityOrdersModal`, `PaginationControls`)는 비-cdash 화면에서도 깨지지 않게 hex 폴백 사용.

## 컨텍스트 위생 (읽지 말 것 / 도구 사용)
- **절대 통째로 읽지 말 것**: `data/`(~14GB), `security-api-scan.txt`(~21MB)·`security-command-only.txt`, 가상환경(`venv311`, `.venv-aws`, `backend/venv*`), `**/node_modules`, `**/.next`, `table_cache`/`*test_cache*`, `*.tfstate`.
- 탐색은 **Glob/Grep으로 스코프**해서 한다(루트 전역 `grep -r` 지양). 대용량 로그/스캔 파일은 `grep`로 필요한 줄만.
- 큰 컴포넌트(예: `FacilityDetailPanel.tsx` 4천 줄)는 필요한 구간만 `Read offset/limit`로.

## 디버깅 / 검증
- ⚠ **`frontend/next.config.mjs`는 `typescript.ignoreBuildErrors: true` + `eslint.ignoreDuringBuilds: true`** → 빌드가 타입/린트 에러로 실패하지 않는다. **기존 코드에 선행 타입 에러가 다수 존재**한다.
  - 따라서 `npx tsc --noEmit` 결과는 **본인이 수정한 파일로 필터**해서 본다(`... | grep <파일>`). 전체 에러 0을 기대하지 말 것.
- UI/className 변경은 로직·구조를 바꾸지 않으므로 `tsc`가 통과하면(=JSX 파싱·타입 OK) 안전. 시각 확인은 사용자에게 `Ctrl+Shift+R` 안내.
- 백엔드 변경은 `backend/tests` pytest로 확인.

## 빌드 / 배포 (AWS staging) ★
계정 `195748745315`, 리전 `ap-northeast-2`, env `staging`. SSO 프로필: `mcm-kesi-staging`(`export AWS_PROFILE=mcm-kesi-staging`).
- ECR 리포: `mcm-ieps-staging-{next,backend,worker}` / ECS 클러스터 `mcm-ieps-staging` / 서비스 `mcm-ieps-staging-{next,backend}` (worker는 SQS 트리거 태스크라 상시 서비스 없음).
- 이미지↔Dockerfile: **next=`frontend/Dockerfile`, backend=`backend/Dockerfile`, worker=`scraper/Dockerfile`**. 빌드 컨텍스트는 모두 **repo 루트**(`docker build -f <dir>/Dockerfile ... .`), `--platform linux/amd64`.
- **배포 절차(중요)**: 태스크 정의가 `:latest`가 아니라 **고정 태그**를 가리킨다. 따라서:
  1. 이미지 빌드 → 설명 태그(`<work>-YYYYMMDD-HHMMSS`) + `latest`로 ECR 푸시
  2. **현재 태스크 정의를 받아 image만 새 태그로 바꿔 새 리비전 등록** (`register-task-definition`)
  3. `aws ecs update-service --task-definition <새 리비전 ARN>`
  - ❌ `force-new-deployment`만 하면 **옛 태그로 재시작**될 뿐 반영 안 됨.
- modernize 같은 **프론트 전용 변경은 `next` 이미지만** 재배포(가벼움). 백엔드 OCR 이미지(~15GB)는 백엔드 변경 시에만.
- `.dockerignore`는 `data/`·venv·`.git`·대용량 스캔파일을 제외해야 빌드 컨텍스트가 작아진다(미제외 시 14GB 전송).

## 일반 작업 원칙
- 되돌리기 어렵거나 외부 반영(배포·푸시·삭제) 작업은 **먼저 확인**받고 실행한다. 결과는 사실대로 보고(실패는 실패로).
- 커밋/푸시는 사용자가 요청할 때만. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
