# infra/aws/cloudium — 클라우디움 보안서버 → S3 이전

온프렘 클라우디움(사이버다임 문서중앙화, 가비아 공급) 어플라이언스를 S3 로 이전하기 위한 인프라 스크립트.
서버 노후(도입 5년+)·소음·연 460~480만원 유지보수료를 해소하고, 랜섬웨어 대비를 **예방형에서 불변형으로** 바꾸는 것이 목적.

## 현황 실측 (2026-07 기준)

| 항목 | 값 |
|---|---|
| 총 용량 | 5,230,692,544,851 B = **4,872 GB** (4.76 TiB) |
| 문서 수 | 1,193,509 |
| 폴더 수 | 226,114 (S3 에서는 0바이트 객체로 변환) |
| 평균 파일 크기 | **4.38 MB** |
| 축적 속도 | 2020-07 개설 → 6년간 4.87TB ≈ **연 0.8TB** |
| 콜드 비율 | 약 90% (연 5회 미만 조회) |

## 설계 결정과 근거

| 결정 | 근거 |
|---|---|
| **전량 S3 Standard** | 검색요금·최소보관·조기삭제가 전부 $0. 백신 스캔·인덱싱·폴더 이름변경 같은 대량 작업으로 청구서가 터지지 않는다. 월 $122 로 현행 대비 여전히 절반 이하 |
| **Glacier IR 미사용** | AWS 가 File Gateway 와의 조합을 명시적으로 비권장. 검색요금 $0.03/GB 라 백신 전체 스캔 1회에 $131 발생 |
| **Object Lock = GOVERNANCE** | COMPLIANCE 는 루트도 삭제 불가 → 발주처 "자료 파기" 요구에 응할 수 없어 계약과 충돌. GOVERNANCE 는 지정 롤만 우회 가능해 랜섬웨어 방어와 파기 대응을 둘 다 만족 |
| **자동 파기 규칙 없음** | 인허가 업무는 사후관리·변경허가로 자료가 재소요된다. 자동 삭제는 사고 위험이 이득보다 크다. 파기는 요청 시 수동 스크립트(옵션)로 실행 |
| **CMK(고객관리형 키)** | 발주처 설명력 — 전용 키·키 사용 이력(CloudTrail)·키 삭제로 crypto-shredding 파기 증빙. 월 $1 |
| **Bucket Key 활성** | 119만 객체라 KMS 요청비가 무시 못 할 규모. 최대 99% 절감 |
| **DeleteObjectVersion 미부여** | 게이트웨이 롤이 탈취돼도 과거 버전을 파괴할 수 없게. 랜섬웨어 방어의 핵심 |

> ⚠ **Object Lock 은 버킷 생성 시에만 활성화할 수 있다.** 사후 소급 불가.
> 이 스크립트로 만든 버킷을 그대로 운영에 쓴다. 연습은 `-Bucket` 에 다른 이름을 줄 것.

### 계정 분리 권고
문서 아카이브를 앱(`mcm-kesi-staging`) 계정과 같이 두지 말 것. 권한·과금 분리와 랜섬웨어 격리(계정 탈취 시 사본 생존)를 위해 **전용 계정**을 만들고 그 프로필을 `-AwsProfile` 로 지정한다.
향후 통합허가 계획서 작성 플랫폼에서 이 데이터를 읽을 때도 계정이 달라 문제되지 않는다
(같은 리전이면 크로스 계정 데이터 전송은 무료, 성능도 동일).

#### 조직 현황 (2026-07 확인)

| 항목 | 값 |
|---|---|
| Organization | `o-i3vxiui5f5` (FeatureSet **ALL** → 계정 생성·SCP 가능) |
| 관리 계정 | `195748745315` "NotoriousBoy" (nagashino2014@gmail.com) |
| Identity Center | `ssoins-7230c5bc5d8984d6` / identity store `d-9b6756b5f9` |
| 권한 세트 | `AdministratorAccess` |
| 멤버 계정 | 없음 (관리 계정 1개뿐) |

이미 Organizations + Identity Center 가 갖춰져 있으므로 `00-create-account.ps1` 로 멤버 계정을 만들고
SSO 프로필만 추가하면 된다. **루트 로그인 없이** 관리 계정에서 `OrganizationAccountAccessRole` 로 접근된다.

#### 루트 이메일은 전 세계에서 유일해야 한다
이미 쓴 주소는 재사용할 수 없다. Gmail 은 `+태그` 를 붙여도 같은 받은편지함으로 배달되므로
`nagashino2014+kesidocs@gmail.com` 처럼 쓰면 새 메일함 없이 계정을 만들 수 있다.
루트 이메일은 **나중에 변경 가능**하니, 회사 도메인 그룹 주소가 준비되면 그때 옮기면 된다
(개인 Gmail 이 회사 인프라의 루트로 남으면 인수인계·감사에서 문제가 된다).

## 실행 순서

```powershell
# 0) 전용 계정 생성 + SSO 할당 (관리 계정 프로필로 실행)
.\infra\aws\cloudium\00-create-account.ps1 -Email "nagashino2014+kesidocs@gmail.com" -DryRun
.\infra\aws\cloudium\00-create-account.ps1 -Email "nagashino2014+kesidocs@gmail.com"
#    → 출력된 프로필 스니펫을 ~/.aws/config 에 붙여넣고
aws sso login --profile kesi-docs-prod

# 1) 버킷 + KMS + 암호화 + Object Lock + 버킷정책 + Lifecycle
.\infra\aws\cloudium\01-create-bucket.ps1 -AwsProfile kesi-docs-prod

# 무엇을 할지만 먼저 확인
.\infra\aws\cloudium\01-create-bucket.ps1 -AwsProfile kesi-docs-prod -DryRun

# 2) IAM 롤 3종 (출력된 버킷명·KMS ARN 을 그대로 넣는다)
.\infra\aws\cloudium\02-create-iam.ps1 `
     -AwsProfile kesi-docs-prod `
     -Bucket kesi-docs-archive-<accountId> `
     -KmsKeyArn arn:aws:kms:ap-northeast-2:<accountId>:key/xxxx
```

두 스크립트 모두 **멱등**이다. 다시 실행해도 이미 적용된 항목은 건너뛴다.

## 파일

| 파일 | 역할 |
|---|---|
| `00-create-account.ps1` | Organizations 멤버 계정 생성 + Identity Center 권한 할당 + 프로필 스니펫 출력 |
| `01-create-bucket.ps1` | KMS CMK → 버킷(Object Lock) → 퍼블릭차단 → SSE-KMS → 기본보존 → 버킷정책 → Lifecycle → 태그 |
| `02-create-iam.ps1` | 롤·정책 3종 생성/갱신 |
| `04-pilot-measure.ps1` | T: 성능 파일럿 — **현재는 열거 차단으로 사용 불가**(벤더가 열거 권한을 열어주면 유효) |
| `05-verify-staging.ps1` | 탐색기로 복사해 온 로컬 스테이징 검증 — 누락·0바이트·S3 키 길이·특수문자·빈 폴더 |
| `06-upload-s3.ps1` | 스테이징 → S3 업로드. **중단 후 재개 가능**, 업로드 검증, 옵션으로 로컬 정리 |
| `lifecycle.json` | Lifecycle 규칙 (아래 표) |
| `bucket-policy.json` | TLS 강제 + 버전 파괴 Deny (`{{BUCKET}}` 등 치환) |
| `iam-filegateway-policy.json` | 게이트웨이 최소권한 |
| `iam-purge-policy.json` | 파기 담당(Governance 우회) |
| `iam-audit-readonly-policy.json` | 감사·조회 전용 |

### Lifecycle 규칙

| ID | 상태 | 내용 |
|---|---|---|
| `abort-incomplete-multipart-7d` | Enabled | 중단된 멀티파트 업로드 7일 후 정리 — **마이그레이션 중 끊긴 업로드가 계속 과금되는 것을 막는다** |
| `cleanup-expired-delete-markers` | Enabled | 고아 삭제마커 정리 |
| `noncurrent-to-standard-ia-30d` | Enabled | 이전 버전은 30일 후 Standard-IA 로 (조회가 거의 없으므로) |
| `noncurrent-expire-365d-keep-5` | Enabled | 이전 버전 365일 후 만료, 단 **최근 5개 버전은 항상 보존** |
| `OPTIONAL-current-to-standard-ia-30d` | **Disabled** | 향후 비용 최적화용. 6개월 운영 후 실제 접근 패턴을 보고 켠다 |

**현행(최신) 객체를 자동 삭제하는 규칙은 없다.** 의도된 설계다.

> Object Lock 보존기간(기본 90일) 중인 버전은 Lifecycle 이 삭제하지 못하고 락 만료 후 처리된다. 정상 동작이다.

## 롤 3종

| 롤 | 신뢰 주체 | 권한 요약 |
|---|---|---|
| `kesi-docs-filegateway` | `storagegateway.amazonaws.com` | 읽기·쓰기·삭제마커 생성. **`s3:DeleteObjectVersion` 미부여** |
| `kesi-docs-purge` | SSO `AdministratorAccess` 권한 세트로 로그인한 principal 만 | 버전 삭제 + `BypassGovernanceRetention` + Batch Operations. 발주처 파기 요구 / 사고 정리 전용 |
| `kesi-docs-audit` | 동일 | 읽기 + CloudWatch Logs 감사 조회 |

### 게이트웨이 로그의 AccessDenied 는 정상이다
AWS 표준 File Gateway 정책에는 `s3:DeleteObjectVersion` 이 포함되지만 여기서는 **의도적으로 뺐다.**
버전관리 버킷에서 파일 삭제·이름변경은 삭제마커 생성으로 처리되므로 `s3:DeleteObject` 만으로 동작한다.
게이트웨이 로그에 `DeleteObjectVersion AccessDenied` 가 보이면 설계대로 막힌 것이다.
단, 파일 공유 초기 구성 후 **읽기/쓰기/이름변경/삭제를 실제로 시험**해 다른 권한 누락이 없는지 확인할 것.

## 구축 결과 (2026-07-28 실행·검증 완료)

| 리소스 | 값 |
|---|---|
| 계정 | `921784996915` "KESI Docs Archive" (Organizations 멤버, SSO 프로필 `kesi-docs-prod`) |
| 버킷 | `kesi-docs-archive-921784996915` |
| KMS | `arn:aws:kms:ap-northeast-2:921784996915:key/d614b63c-9c1a-42a1-8a5c-66b09da97f24` (자동 교체 활성) |
| Object Lock | GOVERNANCE 90일 · 버전관리 Enabled |
| 암호화 | SSE-KMS + Bucket Key, SSE-C 차단 |
| 퍼블릭 차단 | 4종 전부 true |
| 롤 | `kesi-docs-filegateway` / `kesi-docs-purge` / `kesi-docs-audit` |

### 실동작 검증 결과

| 시나리오 | 기대 | 결과 |
|---|---|---|
| 업로드 시 SSE-KMS + Bucket Key 적용 | 자동 적용 | ✅ |
| SSO 관리자가 **객체 버전 파괴** 시도 | 거부 | ✅ AccessDenied (원본 버전 생존 확인) |
| SSO 관리자가 **삭제마커 생성**(파일 삭제) | 허용 | ✅ File Gateway 동작에 지장 없음 |
| `kesi-docs-purge` 롤 assume | 가능 | ✅ |
| purge 롤이 **락 걸린 버전 파기**(bypass) | 가능 | ✅ 발주처 파기 요구 대응 가능 |

→ **랜섬웨어가 파일을 암호화해도 과거 버전을 파괴할 수 없고, 정당한 파기는 지정 롤로 가능**함이 실증됨.
검증에 쓴 테스트 객체는 모두 제거해 버킷은 비어 있다.

## 구축 중 실제로 부딪힌 함정 (재발 방지)

| 증상 | 원인 · 대응 |
|---|---|
| `MalformedPolicy: Policy has invalid action` | **`s3:PutObjectLockConfiguration` 은 존재하지 않는 액션**이다. 버킷 단위는 `s3:PutBucketObjectLockConfiguration` |
| 스크립트가 자기 Lifecycle 적용에서 막힘 | 버킷 정책 Deny 에 `s3:PutLifecycleConfiguration` 을 넣었더니 스크립트 자신이 차단됐다. **의도적으로 뺐다** — 다시 넣지 말 것(자동 삭제 규칙이 없어 방어 가치도 낮다) |
| purge 롤 `AssumeRole` 이 AccessDenied | 신뢰 정책의 `aws:MultiFactorAuthPresent=true` 조건 때문. **IAM Identity Center(SSO) 세션에는 이 컨텍스트 키가 실리지 않아** 정당한 관리자까지 막힌다. MFA 강제는 Identity Center 레벨에 맡기고, 신뢰 정책은 SSO 권한 세트 ARN 패턴으로 제한하도록 변경 |
| 정책의 `BoolIfExists` MFA Deny | 같은 이유로 SSO 에서 항상 Deny 가 걸려 롤이 무용지물이 된다. 제거함 |
| PS 5.1 에서 스크립트 파싱 실패 | BOM 없는 UTF-8 을 CP949 로 읽어 한글·박스문자가 깨진다. `.ps1` 은 **UTF-8 BOM** 으로 저장할 것 |
| `2>$null` 후 스크립트가 죽음 | PS 5.1 은 native exe 의 stderr 리디렉션을 `NativeCommandError` 로 감싸고 `$ErrorActionPreference='Stop'` 이면 종료된다. 조회는 `Get-AwsOrNull`/`Test-AwsOk` 헬퍼로 감쌀 것 |
| 함수 파라미터 `$Args` | PowerShell 자동 변수와 충돌해 **빈 배열**이 넘어간다. `$CliArgs` 등 다른 이름을 쓸 것 |
| 스크립트 exit code 254 | 조회 실패 exit code 가 스크립트 반환값으로 샌다. 끝에 `exit 0` 명시 |

## 스크립트로 못 하는 수동 작업

| 항목 | 방법 |
|---|---|
| MFA Delete | **권장하지 않음(선택).** 루트 계정의 **액세스 키**가 있어야 설정되는데 AWS 는 루트 액세스 키 발급을 강력히 비권장한다. 게다가 Organizations 멤버 계정은 루트 비밀번호가 미설정 상태로 생성돼 절차가 더 번거롭다. **이 설계에서는 이미 ① Object Lock GOVERNANCE ② 버킷 정책의 `DeleteObjectVersion`·`PutBucketVersioning` Deny ③ 게이트웨이 롤의 버전삭제 권한 미부여 로 같은 목적이 달성되므로 생략해도 방어에 공백이 없다** |
| 루트 계정 보호 | 새 계정(921784996915)의 루트에 **MFA 등록** + 연락처 확인. 평시 작업은 SSO 로만 한다 |
| **Identity Center MFA 강제** | 롤 신뢰 정책의 MFA 조건이 SSO 에서 작동하지 않으므로, MFA 는 여기서 걸어야 한다. Identity Center → 설정 → 인증 → MFA 를 "모든 로그인마다 요구"로 설정 |
| (선택) SCP 가드레일 | FeatureSet 이 ALL 이라 SCP 사용 가능. 아카이브 계정에 `s3:DeleteBucket` 금지·리전 제한·CloudTrail 중지 금지를 걸면 관리자 실수까지 차단된다 |
| CloudTrail 데이터 이벤트 | 발주처 감사·파기 증빙용. 별도 트레일에서 이 버킷의 객체 수준 이벤트를 켠다 |
| File Gateway 배포 | 온프렘 하이퍼바이저에 게이트웨이 VM + **캐시 SSD 1TB** (핫 데이터 487GB 를 전부 캐시에 상주시켜 egress 최소화) |
| AD 연동 · SMB 감사 로그 | 파일 공유 생성 시 CloudWatch 로그 그룹 지정 (사용자명·IP·작업종류 기록) |

## 클라우디움에서 데이터 추출 시 주의 (T: 드라이브)

클라우디움 클라이언트 로그인 후 나타나는 `T:` 는 일반 파일시스템이 아니라 **클라이언트가 만드는 가상 드라이브**다. robocopy 는 동작하지만 다음을 전제로 계획할 것:

- **속도**: 파일마다 서버 왕복 + 복호화가 일어나 로컬 디스크보다 훨씬 느릴 수 있다. 반드시 한 폴더(수 GB)로 **파일럿 측정** 후 전체 소요를 추정한다.
- **스레드**: `/MT:8` 이하로 시작. 높이면 클라우디움 서버가 부하로 불안정해질 수 있다.
- **긴 경로**: 한글 폴더명 + 깊은 구조라 260자 초과가 거의 확실하다. robocopy 는 긴 경로를 지원하지만, 이후 s3 sync 단계까지 고려해 로그를 남긴다.
- **속성 복사**: 가상 드라이브는 ACL/소유자 복사가 지원되지 않을 수 있다. `/COPY:DAT` 가 실패하면 `/COPY:DT` 로 낮춘다.
- **제외 대상**: `휴지통`, `반출 문서`, `즐겨찾기`, `미 저장 문서` 등은 클라우디움 고유 가상 항목이므로 `/XD` 로 제외한다. `S:`(cloudium 임시)도 대상이 아니다.
- **감사 로그 폭증**: 119만 파일을 읽으면 클라우디움 서버에 열람 로그가 그만큼 쌓인다. 이전 작업 전 벤더/관리자와 공유할 것.
- **개정 이력**: 화면의 "문서 1,193,509" 가 최신본만인지 개정 이력 포함인지 확인 필요. 과거 개정본까지 가져가면 용량이 몇 배가 될 수 있다.

## ⚠ 선결 과제: 클라우디움 프로세스 화이트리스트 (2026-08-18 실측)

**현재 상태로는 robocopy 기반 마이그레이션이 불가능하다.** 탐색기에서는 T: 가 정상적으로 열리지만,
스크립트·명령줄 도구는 전부 차단된다.

| 실행 주체 | 결과 |
|---|---|
| 탐색기(explorer.exe) | 정상 접근 (스크린샷 확인) |
| `powershell.exe` | `UnauthorizedAccessException` / `0x80070005` |
| `robocopy.exe` | `ERROR 5 (0x00000005) Accessing Source Directory T:\` — exit **16** |
| `cmd.exe` (`dir T:\`) | `Access is denied` |

세션·권한 문제가 아님을 확인했다 — 탐색기와 PowerShell이 **동일 세션(1)·동일 사용자·둘 다 비관리자**인데도
결과가 갈린다. 배경에 `PantaFSService` / `TEFSvrP64`(세션 0, 경로 조회 불가한 보호 프로세스)가 떠 있고
`T:` 는 FileSystem·Size 가 비어 있는 필터 드라이버 가상 볼륨이다.

즉 **프로세스 화이트리스트**가 원인이고, 이는 오작동이 아니라 클라우디움의 랜섬웨어 방어 기능이다
(스크립트에 의한 대량 파일 조작을 막는 것이 목적).

### 해결 경로

| 순위 | 방법 | 비고 |
|---|---|---|
| 1 | **관리 콘솔에서 허용 프로세스 예외 추가** (`robocopy.exe`) | 가장 깔끔. ⚠ 마이그레이션 기간 한정 + 전용 PC 로 제한할 것 — 상시 개방은 방어를 무력화한다 |
| 2 | **벤더(사이버다임/가비아) 일괄 반출 도구 요청** | 가장 안전·완전. **계약 해지 통보 전, 협상력이 있을 때** 확보할 것 |
| 3 | 클라이언트 UI 의 반출/내려받기 기능 활용 | 상단 메뉴의 `반출 문서`·`외부 배포용 URL 관리` 계열. 119만건 대량 처리 가능한지 확인 필요 |
| 4 | 탐색기 수동 복사(폴더 단위 분할) | 동작은 하지만 **재개·검증·로그가 없다**. 최후 수단 |

### 추가 실측 (2026-08-18, robocopy 허용 등록 후)

관리 콘솔 **"PC매체 제어"** 에 `robocopy.exe` 를 허용 프로그램으로 등록했으나 **효과 없음**.

| 확인 | 결과 |
|---|---|
| robocopy `T:\` (따옴표 없음) | `Source T:\` 로 정확히 인식 후 `ERROR 5` — exit 16 |
| robocopy `"T:\."` (trailing-dot) | 동일 |
| cmd `dir T:\` | `Access is denied` (exit 1) |
| **cmd.exe 프로세스 실행 자체** | **정상** (로그 파일 생성됨) |

→ 클라우디움은 "프로세스 실행"이 아니라 **"해당 프로세스의 T: 드라이브 접근"** 을 막는다.
→ 경로 표기 오류도 배제됐다(두 형식 모두 robocopy 가 소스를 올바로 인식한 뒤 거부).

> ⚠ 첫 배치 테스트는 무효였다 — `robocopy "T:\"` 는 `\"` 가 따옴표를 이스케이프해
> 뒤 인자가 전부 경로에 붙는다(`/L` → `\L`). cmd 에서 드라이브 루트는 **따옴표 없이** `T:\` 로 쓸 것.

### 해결됨 → 그러나 새 제약 발견 (2026-08-18, 재로그인 후)

**"보안 관리 > PC매체 제어 > 대상 응용 프로그램 설정"** 에 `robocopy` 를 "사용"으로 등록하고
**클라이언트 재로그인** 하니 robocopy 의 T: 접근이 열렸다(`exit=0`). 설정 메뉴는 PC매체 제어가 맞았고,
**재로그인이 반영 조건**이었다. 탐색기 → D: 폴더 복사도 정상 동작 확인.

그러나 두 가지 제약이 남아 **robocopy 단독 자동 마이그레이션은 불가능하다.**

#### 제약 ① 디렉터리 열거 차단 (핵심)

| 시도 | 결과 |
|---|---|
| `robocopy T:\ /LEV:1` | exit 0 이지만 **목록이 빔** — 최상위 폴더가 안 보인다 |
| `robocopy T:\한국환경안전연구원 /LEV:1` | **성공** — 파일 2개 정상 표시(`test.xlsx`, `이미지 파일.png`) |
| `robocopy T:\한국환경안전연구원 /LEV:2` | 파일 2개만. **하위 폴더 226,114개가 안 보인다** |

→ **경로를 직접 지정하면 그 폴더의 파일은 읽히지만, 하위 디렉터리 목록은 얻을 수 없다.**
   열거 권한이 explorer 에만 있는 것으로 보인다. 재귀 복사(`/E`)가 성립하지 않으므로
   폴더 22.6만 개의 경로를 모두 사전에 알지 못하면 자동 반출이 안 된다.

#### 제약 ② 간헐적 접근 거부

동일 명령을 0.7초 간격 5회: `0 / 16 / 0 / 0 / 0` — 산발적으로 거부된다.

> ⚠ robocopy 기본 재시도값은 `/R:1000000 /W:30` 이다. 이 거부를 만나면 30초씩 100만 번 재시도하며
> 사실상 멈춘 것처럼 보인다(실제로 겪었다). **반드시 `/R:0~3 /W:1~5` 로 낮출 것.**

### 그래서 마이그레이션 경로는 둘

| 경로 | 상태 |
|---|---|
| **A. 탐색기 수동 복사 → 로컬에서 자동화** | **지금 실행 가능.** 탐색기 복사는 동작이 확인됐다. T: → `D:\staging` 을 탐색기로 옮긴 뒤, 검증·S3 업로드는 로컬 디스크 대상이라 스크립트로 완전 자동화된다 |
| **B. 벤더에 열거 권한 / 일괄 반출 도구 문의** | [vendor-export-request.md](vendor-export-request.md) 에 실측 근거와 질문 정리 완료. **해지 통보 전에** 요청할 것 |

A 는 확실히 되므로 이것을 기준선으로 잡고, B 가 풀리면 자동화 범위를 넓히는 편이 안전하다.
`04-pilot-measure.ps1` 은 B 가 풀린 경우에만 의미가 있다(현재는 열거 차단으로 인벤토리 단계를 못 넘는다).

## A안 실행 워크플로우 — 탐색기 복사 → 검증 → 업로드

열거 차단 때문에 **T: 에서 꺼내는 단계만 수동**이고, 그 이후는 전부 자동이다.
`D:` 여유가 1.86TB, 총량이 4.87TB 라 **폴더 단위로 나눠 4회 정도 반복**하게 된다.

### 원본 경로 구조 (2026-08-18 확인)

```
T:\                                  ← 루트. 아래 6개 항목
├─ 한국환경안전연구원 (부서 폴더)      ← 전사 폴더 아래 같은 폴더로 가는 바로가기
├─ 공유 폴더
├─ 전사 폴더                          ← 실제 계층은 여기
│   └─ 한국환경안전연구원              ← ★ 실데이터 위치
│       ├─ 통합환경1본부 / 통합환경2본부 / 화학안전본부 / 부설연구소 / 영업관리본부 / 울산지사 (부서 폴더)
│       ├─ 통합허가Project / 광양제철 / 녹색기술 / 삼성전자 / … (파일 폴더)
│       └─ test.xlsx, 이미지 파일.png
├─ 반출 문서 / 즐겨찾기 / 휴지통       ← 클라우디움 가상 항목. 복사 대상 아님
```

### 반복 절차

```powershell
# 1) 탐색기로 폴더 하나를 D:\staging 으로 복사 (수동)
#    예: T:\전사 폴더\한국환경안전연구원\통합환경1본부  →  D:\staging\통합환경1본부

# 2) 검증 — 누락·0바이트·S3 키 제약 확인
.\infra\aws\cloudium\05-verify-staging.ps1 -Staging "D:\staging\통합환경1본부"

# 3) 업로드 확인 (실제 전송 없음)
.\infra\aws\cloudium\06-upload-s3.ps1 -Staging "D:\staging\통합환경1본부" `
     -Prefix "전사폴더/한국환경안전연구원/통합환경1본부" -DryRun

# 4) 실제 업로드 → 검증 통과 시 로컬 정리(다음 폴더 공간 확보)
.\infra\aws\cloudium\06-upload-s3.ps1 -Staging "D:\staging\통합환경1본부" `
     -Prefix "전사폴더/한국환경안전연구원/통합환경1본부" -DeleteLocalAfterVerify
```

전량을 옮긴 뒤 마지막에 원본 실측치와 대조한다:

```powershell
.\infra\aws\cloudium\05-verify-staging.ps1 -Staging "D:\staging" `
     -ExpectedFiles 1193509 -ExpectedBytes 5230692544851
```

### 주의

- **프리픽스로 원본 구조를 유지할 것.** File Gateway 로 마운트하면 그대로 폴더 트리가 된다.
  한글 프리픽스도 문제없다.
- 탐색기 복사 중 오류 창이 뜨면 **건너뛰지 말고 재시도**할 것. 건너뛴 파일은 05 의 누락 검사에서만 드러난다.
- `06` 은 `aws s3 sync` 기반이라 **중단되면 같은 명령을 다시 실행**하면 이어서 진행된다.
  중단된 멀티파트는 Lifecycle 의 `abort-incomplete-multipart-7d` 가 정리한다.
- ⚠ 버킷에 Object Lock GOVERNANCE 90일이 걸려 있다. 잘못 올린 객체는 90일간 삭제되지 않고
  `kesi-docs-purge` 롤로 bypass 해야 하므로 **처음에는 반드시 `-DryRun`** 을 거칠 것.
- `s3 sync` 는 빈 폴더를 올리지 않는다. 보존이 필요하면 `06 -KeepEmptyFolders`.

## 마이그레이션 전 파일럿 측정 (`04-pilot-measure.ps1`) — 현재 사용 불가

T: 는 가상 드라이브라 **회선 대역폭 계산만으로 일정을 세울 수 없다.** 대부분의 경우 드라이브 자체가 병목이고,
평균 4.38MB 문서 119만건이라 "용량 병목"인지 "파일 개수 병목"인지에 따라 대응이 정반대다. 그래서 먼저 실측한다.

```powershell
# 1) 인벤토리만 (복사 없음 — 완전히 안전, 먼저 이것부터)
.\infra\aws\cloudium\04-pilot-measure.ps1 -Source "T:\한국환경안전연구원\통합환경1본부\2024" -InventoryOnly

# 2) 전체 측정
.\infra\aws\cloudium\04-pilot-measure.ps1 `
     -Source "T:\한국환경안전연구원\통합환경1본부\2024" -Staging "D:\cloudium-pilot"

# 3) S3 업로드 처리량까지
.\infra\aws\cloudium\04-pilot-measure.ps1 -Source "T:\...\2024" -Staging "D:\cloudium-pilot" `
     -TestS3Upload -Bucket kesi-docs-archive-921784996915 -AwsProfile kesi-docs-prod
```

### 대상 폴더 고르는 기준
- **2~10GB** 규모. 수백 MB 면 오차가 크고, 수십 GB 면 측정에만 반나절 걸린다
- 최상위(전사 폴더)가 아니라 **본부/연도 단위**의 전형적인 실무 폴더
- 특수한 폴더(동영상만 있다든지)보다 **문서가 섞인 일반적인 구성**
- `휴지통`·`반출 문서`·`즐겨찾기`·`미 저장 문서`는 클라우디움 가상 항목이므로 피할 것

### 결과 읽는 법

| 지표 | 의미와 대응 |
|---|---|
| **병목 = 파일 개수** | 회선을 늘려도 빨라지지 않는다. `/MT` 상향 + 야간 배치 분할이 유효 |
| **병목 = 용량** | 회선 대역폭이 일정을 좌우한다. `/MT` 는 최적값 이상 올릴 필요 없음 |
| `/MT:1` 대비 **1.5배 미만** 향상 | 서버측 동시성 제한 의심 → 낮은 `/MT` 로 안정 운영 (무리하면 클라우디움 서버가 불안정해진다) |
| **260자 이상 경로 건수** | 마이그레이션 스크립트에 긴 경로 처리 필요 |
| `/COPY:DAT` 실패 | 가상 드라이브가 ACL 복사를 지원하지 않음 → `/COPY:DT` 로 낮추고 권한은 별도 이관 검토 |
| **열거 소요 시간** | 그 자체가 탐색기 체감 속도 지표. 전체 119만건 스캔 시간도 함께 외삽된다 |

### 측정 시 주의
- **업무 시간을 피할 것.** 파일을 대량으로 읽으므로 클라우디움 서버에 부하가 간다
- **1회차만 진짜 cold.** 클라이언트 캐시 때문에 2회차부터 빨라질 수 있어 리포트에 `(cold)` 로 표시된다.
  정확한 cold 재측정은 클라이언트 재시작 후 첫 라운드만 유효
- 읽은 파일 수만큼 **클라우디움 감사 로그가 쌓인다.** 사전에 관리자와 공유할 것
- 스크립트는 T: 에서 **읽기만** 한다. `robocopy /MIR` 은 쓰지 않으며, 삭제는 스테이징 폴더 하위로만 제한된다
  (스테이징에 `T:`/`S:` 를 지정하면 실행이 거부된다)

## 예상 비용

| 구분 | 금액 |
|---|---|
| 스토리지 4,872GB × $0.025 | $121.80/월 |
| 이전 버전 누적(10% 가정) + 요청 + 감사로그 + KMS | 약 $17/월 |
| egress (캐시 1TB 적용 시) | $0~25/월 |
| **월 합계** | **약 $139~164 (19~23만원)** |
| 초기 일회성 (PUT 141만건 + File Gateway 쓰기 4,872GB) | 약 $55 |

현행 온프렘(유지보수 480만원 + 전기 75만원 + 하드웨어 상각 160만원 ≈ 연 715만원) 대비 **5년 누적 약 1,890만원 절감**.

## 후속 작업 (미착수)

| # | 산출물 | 비고 |
|---|---|---|
| 03 | `03-enable-audit.ps1` — CloudTrail 데이터 이벤트 + Storage Lens | 감사·비용 가시화 |
| ~~04~~ | ~~`04-pilot-measure.ps1` — T: 파일럿 측정~~ | **완료** |
| ~~05~~ | ~~`05-verify-staging.ps1` — 스테이징 검증~~ | **완료** |
| ~~06~~ | ~~`06-upload-s3.ps1` — S3 업로드~~ | **완료** |
| 07 | `07-rollback-runbook.md` — 시점 롤백 (Batch Operations) | 랜섬웨어 사고 시. **평시에 리허설 필수** |
| 09 | `09-purge-project.ps1` — 수동 파기 (옵션) | 발주처 파기 요구 대응. `kesi-docs-purge` 롤로 실행(MFA 는 Identity Center 레벨) |
| 08 | `08-grant-platform-access.ps1` — 플랫폼 크로스 계정 읽기 | 통합허가 계획서 플랫폼(별도 계정)에 읽기 허용. **버킷 정책 + KMS 키 정책 + 플랫폼 롤 IAM 3곳을 모두 열어야 한다**(크로스 계정은 리소스 정책과 IAM 양쪽 필요 — KMS 를 빠뜨려 AccessDenied 나는 것이 가장 흔한 실수). 플랫폼 쓰기는 Object Lock 없는 별도 버킷으로, S3 직접 쓰기 후에는 File Gateway `RefreshCache` 필요 |
| — | 발주처 제출용 자료 관리 체계 확인서 | 영업 자산 |
