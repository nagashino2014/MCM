# CLAUDE.md — MCM / PermitIQ

IEPS(통합환경허가) 데이터 수집·파싱 + 계약/사업장 관리 모노레포. 상세 도메인 설명은 [README.md](README.md) 참고.
이 문서는 Claude Code가 이 저장소에서 작업할 때의 **운영 규칙**이다. (사람이 읽는 문서는 README, AI 작업 규칙은 여기)

## 브랜치·배포 운영 규칙 (모든 세션 공통) ★
여러 Claude 세션이 각자 브랜치에서 작업하다 **다른 브랜치 기능이 빠진 이미지가 배포되는 사고가 2회**(2026-08-26·08-31) 있었다. 어느 세션이든 다음을 지킨다.
- **작업 시작 전**: `git fetch origin` 후 원격 브랜치 상황을 확인하고, **최신 main(또는 진행 중인 통합 브랜치)에서 분기**한다. 오래된 분기점 위에 새 작업을 쌓지 않는다.
- **배포는 반드시 `infra/aws/ops/staging-deploy-next.ps1` 로**: 원격 `claude/*`·`codex/*`·`main` 커밋 누락을 검사한다. 미커밋 변경 또는 `HEAD != origin/main`이면 배포를 차단한다(`-Force`로도 우회 불가). 사용자 승인 후 커밋·main 통합·푸시를 완료하고 배포한다. 2026-09-11에는 미커밋 UI를 운영에만 배포한 뒤 다음 main 배포에서 UI가 사라졌다. **운영 반영과 저장소 통합은 함께 완료해야 한다.**
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

## UI 규칙 — Precision (2026-09-10 사용자 요청)

이 앱의 UI는 [docs/ui-precision-standard.md](docs/ui-precision-standard.md)를 따른다. 이전 Modernize/Soft Glass Ink의 충돌하는 시각 규칙을 대체한다.
- 기존 cdash 컴포넌트/API를 유지한다. KESI-IEPS는 별도 플랫폼이며 이번 요청을 프레임워크 교체로 해석하지 않는다.
- 무광 불투명 면, 중립 경계 1px, 카드 8px/입력·버튼 8px, 카드 그림자·blur·배경 그라데이션 금지. 주요 버튼의 기존 블루·보라 색은 사용자 요청으로 유지.
- 공통 `--cd-*` 토큰을 사용하고 페이지 CSS에서 같은 토큰을 재정의하지 않는다. Light/Dark·포털 루트의 `cdash-vars`와 `data-theme`를 유지한다.
- 메뉴 그룹·부모·자식과 현재 경로/query를 명확히 표시한다. 기존 248px/76px 레일/드로어 구조를 보존한다.
- 긴 사용법·배경은 `CdHelp`의 `?`로 연결하고, 오류·필수 입력·저장 상태·실행 영향은 화면에 남긴다. 제목 반복·개발 단계 설명은 축약하되 기존 카드·요소는 임의로 삭제하지 않는다.
- 날짜 입력은 기존 `CdDateInput`의 YYYYMMDD 정규화와 유효성 검사를 유지한다.
- 시각 변경은 실제 컴포넌트의 라이트/다크·좁은 화면·키보드 검증과 함께 보고한다.

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
- **배포 명령 자동 출력(★ 사용자 요청 2026-09-08)**: Claude Code 원격 세션은 AWS 자격증명·PowerShell 이 없어 직접 배포할 수 없다. 따라서 **기능 커밋·푸시를 마쳤거나 사용자가 스테이징 반영/배포를 언급하면, "로컬에서 해주세요" 식 안내로 끝내지 말고 로컬 PowerShell 에 그대로 붙여 넣을 수 있는 명령 블록을 반드시 함께 출력**한다. 기본 형태:
  ```powershell
  git fetch origin
  git checkout <세션 브랜치>          # 없으면 git checkout -b <세션 브랜치> origin/<세션 브랜치>
  git pull origin <세션 브랜치>
  $env:AWS_PROFILE = "mcm-kesi-staging"
  .\infra\aws\ops\staging-deploy-next.ps1 -Wait   # 프론트 변경 → next 이미지만
  ```
  - 백엔드/워커 변경이면 해당 이미지(`backend`/`worker`) 절차(위 1→2→3)를 aws 명령으로 함께 나열한다. 마이그레이션이 있으면 `staging-apply-migrations.ps1 -Files ...` 를 배포 앞에 붙인다.
  - 갈라진 배포 가드 경고가 예상되면(원격에 미머지 브랜치가 있을 때) 어떤 브랜치가 누락되는지와 `y` 진행 가능 여부를 한 줄로 덧붙인다. `-Force` 는 권하지 않는다.
  - 빌드 로그에서 `RUN npm run build` 가 `CACHED` 면 소스가 반영되지 않은 것(체크아웃에 커밋 누락) — 이 확인 포인트도 같이 안내한다.

## 일반 작업 원칙
- 되돌리기 어렵거나 외부 반영(배포·푸시·삭제) 작업은 **먼저 확인**받고 실행한다. 결과는 사실대로 보고(실패는 실패로).
- 커밋/푸시는 사용자가 요청할 때만. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**최우선: 사용자의 명시적 지시 없이 기존 UI 구조를 변경하지 않는다.** 트리뷰·상세 양식·카드 배치·표 열·탭·분할 비율·스크롤 부모를 보존하고 컴포넌트의 글자·색·경계·간격만 정리한다. 허용된 구조 변경은 대시보드와 영업 상세의 FHD 하단 재배치 두 건이며 세부사항은 UI 기준 §7을 따른다.

**버튼 반경 후속 지시:** 일반·태그형·필터·아이콘·탭 버튼은 네 모서리 8px(`--mcm-action-radius`)로 통일한다. 링크·label로 구현한 버튼은 `cd-action`을 쓴다. 버튼의 기존 색·크기·배치를 보존하며 개별 rounded 값으로 반경 규칙을 우회하지 않는다.
