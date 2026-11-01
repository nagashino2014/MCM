# RAG & 영업 발굴 1차 — 스테이징 반영 절차서

작성: 2026-11-01 · 대상: PR [#80](https://github.com/nagashino2014/MCM/pull/80) (`codex/sales-intelligence-phase1`) · 계정 `195748745315` / `ap-northeast-2` / 프로필 `mcm-kesi-staging`

이번 반영의 범위는 **1단계: 스키마 적용과 화면 공개**다. 정기 브리핑 자동 실행(`INTEL_BRIEFING_ENABLED`)·전용 ECS 작업·공식 정보원 활성화는 2단계로 미룬다(§8). 상위 안내는 [구현·검증·운영 적용 안내](sales-intelligence-phase1-validation-rollout.md) §5다.

각 단계의 쓰기 작업(DB 적용·머지·배포·스케줄 전환)은 **단계마다 따로 승인**하고 실행한다. 한 단계가 끝나면 그 단계의 확인 항목을 통과한 뒤 다음으로 넘어간다.

---

## 0. 사전 확인 결과 (2026-11-01, 읽기 전용)

| 항목 | 결과 |
|---|---|
| 설치 리허설 | 스테이징 스키마(표 428개) 사본에 319→323 적용 **오류 0**, 2회째 실행도 오류 0(멱등). 322는 실제 권한 템플릿 데이터 위에서 system-admin·ceo·exec·sales·sales-staff에 `intel.briefing.view/create/share` 부여 확인 |
| 리허설 한계 | 사본은 표가 비어 있어 **기존 행이 있어야 드러나는 단계**(기존 신호·브리핑 행에 대한 FK·기본값 채움)는 미검증. 스테이징 intel_signals 13,857건 · intel_rag_briefings 7건 |
| 실제 앱 화면 | 리허설 DB로 실제 MCM 앱(셸 포함)을 띄워 5개 탭·상세 드로어·API 9종 200 응답 확인. API & 스크래핑의 공식 정보원 카드 확인 |
| 번호 충돌 | 원격 전 브랜치에 319~323 사용 없음. main 최고 318 |
| main 의 다른 데이터 마이그레이션 | 317·318 스테이징 적용됨. **315(사업장 시도 보정)는 미적용** — 이 PR과 무관한 초안이며 별도 승인 대상(§8) |
| 현재 배포 | Next 서비스 `mcm-ieps-staging-next:750`. ADT(`rate(1 hour)`)·intel(`cron(0 18 * * ? *)` = 03:00 KST) 두 target 은 `:748` 고정. Next 태스크 정의에 `INTEL_BRIEFING_*` 변수 없음 |

### 기존 표 변경과 고정 배치(748) 호환성

319~323이 **기존 표**에 하는 일은 기본값 있는 열 또는 NULL 허용 열 추가뿐이다. 트리거는 없다.

| 표 | 변경 | 748 배치·현행 Next 영향 |
|---|---|---|
| `scraper_sources` | `official_provider`(NULL 허용), `official_config`(기본 `{}`) | 없음. 기존 INSERT 그대로 동작 |
| `intel_projects` | `source_checked_at`(기본 now()) | 표 자체가 320에서 새로 생김 |
| `intel_rag_briefings` | `access_scope`(기본 `legacy_sales`)·`profile_id`·`run_id`·`snapshot_id`·`schema_version`(기본 1)·`previous_briefing_id` | 없음 |
| `intel_rag_briefing_shares` | `explicit_share`(기본 false) | 없음 |
| `chat_messages` | `shared_record`(NULL 허용) | 없음 |

새 표가 `intel_signals` 를 참조(320 `intel_project_signals` 는 `ON DELETE RESTRICT`)하므로 **프로젝트에 묶인 신호는 삭제가 막힌다.** 748 배치(`scripts/intel-batch.ts`)는 신호를 지우지 않는다. 삭제는 API & 스크래핑 화면의 삭제 버튼뿐이며, 배포 후에는 새 코드가 이 제한을 안내한다.

따라서 **DB 적용(§2)을 앱 배포보다 먼저** 해도 현행 Next·748 배치 모두 그대로 돈다.

---

## 1. DB 백업 (스냅샷)

```powershell
$env:AWS_PROFILE = "mcm-kesi-staging"
aws sso login --profile mcm-kesi-staging
$snap = "mcm-ieps-staging-pre-intel319-" + (Get-Date -Format "yyyyMMdd-HHmm")
aws rds create-db-cluster-snapshot --db-cluster-identifier mcm-ieps-staging --db-cluster-snapshot-identifier $snap --region ap-northeast-2
aws rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier $snap --region ap-northeast-2
$snap
```

확인: 마지막 줄에 스냅샷 이름이 출력되고 `wait` 가 오류 없이 끝난다. 이 이름을 기록해 둔다.

## 2. 마이그레이션 319~323 적용

머지 전이므로 SQL 파일이 있는 **기능 브랜치 워크트리**에서 실행한다. `-Files` 는 반드시 **쉼표**로 구분한다(공백 나열 시 첫 파일만 적용됨).

```powershell
Set-Location 'C:/Users/nagas/Documents/MCM/worktrees/sales-intelligence-phase1'
git status --short   # 비어 있어야 한다
.\infra\aws\ops\staging-apply-migrations.ps1 -Files 319_official_intelligence_sources.sql,320_project_intelligence.sql,321_scheduled_intelligence_briefings.sql,322_briefing_access_permissions.sql,323_briefing_share_deliveries.sql
```

확인(읽기 전용 — 적용 후 Claude 가 대신 조회 가능):
- `intel_projects`·`intel_briefing_profiles`·`intel_briefing_share_deliveries` 표가 존재
- `permission_template_grants` 에 `intel.briefing.%` 15행(5개 템플릿 × 3)
- `intel_rag_briefings` 기존 7건의 `access_scope = 'legacy_sales'`

실패하면 그 파일에서 멈춘다(ON_ERROR_STOP). 앞 파일까지는 적용된 상태이며 모두 멱등이므로, 원인을 고친 뒤 **같은 명령을 다시** 실행한다. 스냅샷 복원은 데이터 손실 위험이 있어 마지막 수단이다.

## 3. PR #80 머지

배포 가드는 `HEAD == origin/main` 을 요구하므로 머지가 배포보다 먼저다.

```powershell
gh pr merge 80 --repo nagashino2014/MCM --merge
```

## 4. Next 배포

공유 체크아웃(`C:\CodingProject\MCM`)에는 다른 작업의 미추적 파일이 있어 가드에 막힐 수 있다. **origin/main 을 가리키는 깨끗한 워크트리**에서 실행한다.

```powershell
Set-Location 'C:/CodingProject/MCM'
git fetch origin
git worktree add --detach ..\MCM-deploy origin/main   # 이미 있으면: Set-Location ..\MCM-deploy; git checkout --detach origin/main
Set-Location '..\MCM-deploy'
$env:AWS_PROFILE = "mcm-kesi-staging"
.\infra\aws\ops\staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait
```

> ADT·intel 배치는 이 명령 직후 고정 revision(748)에 남고 서비스만 새 revision으로 이동한다. 이번 변경은 ADT·intel 이 쓰는 표(`scraper_sources`)의 스키마를 바꾸므로 **§5 스케줄 동반 전환을 같은 날 이어서** 한다(CLAUDE.md "Terraform·Next 배포 경계").

확인 포인트:
- 빌드 로그의 `RUN npm run build` 가 `CACHED` 가 아니어야 한다(캐시면 소스 미반영).
- 원격에 미병합 `claude/*`·`codex/*` 브랜치가 있으면 가드가 누락 경고를 띄운다. 목록을 확인하고 의도한 제외면 `y` 로 진행한다. `-Force` 는 쓰지 않는다.
- 끝에 출력되는 새 태스크 정의 ARN(예: `…:task-definition/mcm-ieps-staging-next:7xx`)을 기록한다.
- 메일 게이트웨이도 같은 이미지로 자동 갱신된다(스크립트 기본 동작).

## 5. 스케줄 동반 전환 (ADT·intel → 새 revision)

10-30 재고정과 같은 방식이다. 현재 target 을 그대로 읽어 **TaskDefinitionArn 만** 바꿔 다시 넣고, 원본은 복구용으로 저장한다.

```powershell
$p = "mcm-kesi-staging"; $r = "ap-northeast-2"
$new = aws ecs describe-services --cluster mcm-ieps-staging --services mcm-ieps-staging-next --query "services[0].taskDefinition" --output text --profile $p --region $r
$rev = ($new -split ":")[-1]; "새 revision: $rev"
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($rule in "mcm-ieps-staging-adt-ingest", "mcm-ieps-staging-intel-batch") {
  $t = (aws events list-targets-by-rule --rule $rule --profile $p --region $r --output json) -join "`n" | ConvertFrom-Json
  [IO.File]::WriteAllText("$env:TEMP\$rule-targets-before.json", (ConvertTo-Json -InputObject @($t.Targets) -Depth 20), $utf8)   # 복구용 원본(put-targets 형식)
  "$rule 현재: " + (($t.Targets | ForEach-Object { $_.EcsParameters.TaskDefinitionArn }) -join ", ")
  $t.Targets | ForEach-Object { $_.EcsParameters.TaskDefinitionArn = $new }
  [IO.File]::WriteAllText("$env:TEMP\$rule-targets.json", (ConvertTo-Json -InputObject @($t.Targets) -Depth 20), $utf8)
  aws events put-targets --rule $rule --targets "file://$env:TEMP\$rule-targets.json" --profile $p --region $r
}
.\infra\aws\ops\staging-protect-pinned-image.ps1 -Revision $rev
.\infra\aws\ops\staging-assert-next-schedules-pinned.ps1
```

확인:
- 두 rule 의 `put-targets` 결과가 `"FailedEntryCount": 0`
- 보호 태그 `schedule-pin-<rev>` 부착, 가드 통과
- 다음 정시 `adt-ingest` 실행(매시)과 다음 03시 `intel-batch` 실행이 ECS 중지된 작업에서 **exit 0**. `CannotPullContainerError` 가 보이면 §9 로 즉시 되돌린다.

## 6. 배포 후 화면 확인 (staging)

`INTEL_BRIEFING_ENABLED` 는 현재 태스크 정의(750)에 없고 배포 스크립트는 이미지만 바꾸므로 꺼진 상태가 유지된다(앱 tick·배치 모두 비활성).

1. 영업/마케팅 → **RAG & 영업 발굴**: 개요·브리핑·영업 발굴·신규 사업장·관심 설정 5탭이 보인다. 권한이 방금 바뀐 계정은 로그아웃 후 다시 로그인해야 반영된다(권한은 로그인 세션에 담김).
2. 브리핑 → AI 질의: 기존 질문형 브리핑·공유받은 브리핑·이력이 그대로 보인다(기존 7건).
3. API & 스크래핑: 수집 설정 아래 **공식 정보원** 카드가 보이고, 기존 신호 목록·수집 설정이 그대로 동작한다.
4. 영업 담당(sales.view 만 있는) 계정으로 같은 메뉴가 열리는지, 권한 없는 계정은 차단되는지 확인한다.
5. Salesboard·견적·전자결재 등 이번 배포에 함께 실린 main 변경(PR #66·#76·#78·#79)이 정상인지 훑어본다.

## 7. 초기 프로젝트 정리 (수집 신호 → 투자 프로젝트)

배포 직후 `intel_projects` 는 비어 있어 영업 발굴·개요가 빈 화면이다. 전사 영업 수정 권한(sales.edit 전체 범위) 계정으로 영업 발굴의 **수집 신호 정리**를 누르면 한 번에 200건씩 `initial_backfill` 로 정리된다(중요 변화 알림을 만들지 않음). 대상 신호는 약 7,500건이다.

⚠ **알려진 문제:** 정리는 최신 신호부터 고르며, 내용 부족으로 건너뛴 신호도 다음 번에 다시 고른다. 같은 화면에서 "신규 0건 · 갱신 0건"이 두 번 연속 나오면 **멈추고** Claude 에 알린다(배치용 `synchronizeBriefingProjects` 는 건너뛴 신호를 기록해 이 문제가 없다. 2단계 전에 UI 경로도 같은 방식으로 고친다).

⚠ **원자료 품질:** 로컬에서 정정한 뉴스 31건 외의 스테이징 기존 뉴스 신호는 새 근거 검증을 거치지 않았다. 품질 표시가 없는 신호는 기존처럼 통과하므로, 배경 기사가 투자 프로젝트로 보일 수 있다. 소급 정정은 별도 작업이다(인계서 §10-B4).

## 8. 이번에 하지 않는 것

| 항목 | 이유·다음 단계 |
|---|---|
| `INTEL_BRIEFING_ENABLED=true` | 전용 ECS 작업 정의·실행 권한·예산·시험 수신자 검증 후(rollout §5-4~8) |
| `intel-briefing-worker.tf` 적용 | 전체 apply 금지. `-target` plan 검토 후 별도 승인 |
| 공식 정보원 활성화 | 고정 배치에 legacy 임베딩 제외 변경이 반영된 revision 이 스케줄에 올라간 뒤(§5 가 그 전제를 충족). 정보원별 인증·이용 범위 확인 필요 |
| 315 사업장 시도 보정 | 이 PR 과 무관한 초안. 236건 쓰기 — 별도 승인 |
| 모바일 앱 OTA | 브리핑 딥링크·화면은 웹 내보내기(`public/m-app`)로 Next 와 함께 나간다. 네이티브 OTA 는 별도 |
| 스크립트 수정 | `scripts/start-intelligence-source-tunnel.ps1` 는 PS 5.1 에서 BOM 때문에 실패한다(파라미터 파일). 로컬 실증용이라 배포와 무관 — 후속 수정 |

## 9. 되돌리기

| 상황 | 조치 |
|---|---|
| 앱 화면 장애 | 서비스를 직전 태스크 정의(배포 전 750)로: `aws ecs update-service --cluster mcm-ieps-staging --service mcm-ieps-staging-next --task-definition mcm-ieps-staging-next:750 --profile mcm-kesi-staging --region ap-northeast-2`. 스키마는 그대로 둬도 구 코드와 호환된다(§0) |
| 배치 실패 | 두 rule 각각 `aws events put-targets --rule <rule> --targets "file://$env:TEMP\<rule>-targets-before.json" --profile mcm-kesi-staging --region ap-northeast-2` — §5 에서 저장한 원본으로 748 재고정. 748 은 `schedule-pin-748` 로 보호돼 있다 |
| 마이그레이션 오류 | 같은 명령 재실행(멱등). 스키마를 지우는 역마이그레이션은 하지 않는다. 데이터 손상 시에만 §1 스냅샷에서 **새 클러스터로** 복원해 비교 |
| 기능 중단 | 정기 실행은 이미 꺼져 있다. 화면만 숨기려면 앱 롤백. 생성 이력·신호·프로젝트는 지우지 않는다 |

---

## 실행 기록

| 일시 (KST) | 단계 | 결과 |
|---|---|---|
| 2026-11-01 12:50 | §1 백업 | 수동 스냅샷 `mcm-ieps-staging-pre-intel319-20261101-1245` available(100%) |
| 2026-11-01 12:52 | §2 319~323 적용 | 5건 적용, exit 0(323 의 `explicit_share` 중복 추가 NOTICE 는 정상). 확인: 신규 표 존재, `intel.briefing.*` 권한 3·템플릿 부여 15, 기존 브리핑 7건 `legacy_sales`, `chat_messages.shared_record` 생성, 신호 13,857건 변화 없음. 표 455개(리허설 453 + 다른 작업의 `proposal_documents`·`proposal_editions`) |
| 2026-11-01 13:01 | §3 PR #80 머지 | 머지 전 main 에 PR #81(용역 제안서, 마이그레이션 319→324 재번호)이 들어와 changelog 충돌 1건 해결(36259e0a). 머지 커밋 `01b9bc21`. 324 의 표는 스테이징에 이미 존재. 원격 `claude/*`·`codex/*` 미병합 브랜치 0 |
| 2026-11-01 13:07 | §4 Next 배포(1차) | `docker login` 실패 — Docker Desktop 자격증명 저장소 오류("The stub received bad data"). 빌드 전 중단, 스테이징 변경 없음 |
| 2026-11-01 13:09 | §4 Next 배포(2차) | 배포 프로세스에만 임시 `DOCKER_CONFIG`(credsStore 없음)·자격증명 도우미를 PATH 에서 제외해 우회. `npm run build` 실제 수행(136s). `next:751`(`deploy-20261101-130932`) 안정화, 메일 게이트웨이 `:32` 동반 갱신. `/api/health` 200, 새 API 401(존재·인증 필요). 임시 설정은 삭제 |
| 2026-11-01 13:2x | §5 스케줄 동반 전환 | ADT·intel 두 target 748→751(`FailedEntryCount` 0), `schedule-pin-751` 부착, 가드 `next-schedules-pinned-ok`. 원본은 `%TEMP%\*-targets-before.json` |
| 2026-11-01 13:26 | §5 확인 | 751 첫 `adt-ingest` 실행 exit 0(13:26:42~13:27:06). intel-batch 첫 실행은 11-02 03:00 KST |
