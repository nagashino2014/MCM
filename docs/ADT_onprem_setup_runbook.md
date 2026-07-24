# ADT 근태 연동 — 사내 PC 설정 런북 (처음 하는 사람용)

이 문서는 **사내 ADT 컨트롤러 PC**에서 근태 파일을 클라우드로 자동 전송하도록 설정하는 절차입니다.
클라우드 쪽(DB·배치·S3 버킷·권한)은 이미 배포되어 있고, 여기서는 **사내에서 해야 할 3가지**만 다룹니다.

- **A. AWS 업로드 키 발급** (한 번)
- **B. 사내 PC에 AWS CLI 설치·등록** (한 번)
- **C. 컨트롤러 파일 출력 + 자동 업로드 설정** (한 번)

전체 그림:
```
컨트롤러가 txt 생성  →  사내 PC가 30분마다 S3에 업로드  →  클라우드가 자동으로 읽어 초과근무 산정
(C단계)                (B·C단계)                          (이미 배포됨)
```

핵심 값(그대로 사용):
| 항목 | 값 |
|---|---|
| AWS 리전 | `ap-northeast-2` (서울) |
| S3 버킷 | `mcm-ieps-staging-adt-attendance` |
| 업로드 경로(prefix) | `incoming/` |
| 업로드용 IAM 사용자 | `mcm-ieps-staging-adt-uploader` |
| 파일명 형식 | `ovrwrk_YYYYMMDD.txt` (예: `ovrwrk_20260724.txt`) |
| 필드 구분자(기본) | 탭(Tab) |

---

## A. AWS 업로드 키 발급 (AWS 콘솔, 관리자 권한 계정으로)

> 이 키는 사내 PC가 S3에 파일을 올릴 때 쓰는 "전용 출입증"입니다. 권한은 `incoming/` 폴더에 **파일 올리기만** 가능하도록 이미 제한돼 있습니다(다른 건 못 함).

1. 브라우저에서 AWS 콘솔 로그인 → 우측 상단 리전을 **아시아 태평양(서울) ap-northeast-2**로 맞춤.
2. 상단 검색창에 **IAM** 입력 → IAM 서비스 열기.
3. 왼쪽 메뉴 **사용자(Users)** → 목록에서 **`mcm-ieps-staging-adt-uploader`** 클릭.
4. **보안 자격 증명(Security credentials)** 탭 → 아래로 스크롤 → **액세스 키 만들기(Create access key)**.
5. 사용 사례에서 **CLI(Command Line Interface)** 선택 → 하단 확인 체크박스 체크 → **다음**.
6. (설명 태그는 비워도 됨) → **액세스 키 만들기**.
7. 화면에 **액세스 키 ID**와 **비밀 액세스 키(Secret access key)** 2개가 나옵니다.
   - **⚠️ 비밀 액세스 키는 이 화면을 벗어나면 다시 볼 수 없습니다.** 반드시 **`.csv 파일 다운로드`**를 눌러 안전한 곳에 보관.
   - 이 두 값을 B단계에서 사용합니다.

---

## B. 사내 PC에 AWS CLI 설치·등록 (컨트롤러 PC에서)

1. **AWS CLI 설치**: 브라우저로 `https://awscli.amazonaws.com/AWSCLIV2.msi` 내려받아 설치(관리자 권한). 기본값으로 다음-다음.
2. 설치 확인: 명령 프롬프트(cmd)를 열고
   ```
   aws --version
   ```
   `aws-cli/2.x ...`가 나오면 성공.
3. **키 등록**: 명령 프롬프트에서
   ```
   aws configure
   ```
   네 가지를 물어봅니다. A단계에서 받은 값과 아래대로 입력:
   - `AWS Access Key ID` → (A-7의 액세스 키 ID)
   - `AWS Secret Access Key` → (A-7의 비밀 액세스 키)
   - `Default region name` → `ap-northeast-2`
   - `Default output format` → `json`
4. **연결 테스트**: 아무 텍스트 파일이나 하나 시험 업로드해 봅니다.
   ```
   echo test > test.txt
   aws s3 cp test.txt s3://mcm-ieps-staging-adt-attendance/incoming/test.txt
   ```
   `upload: ...`가 나오면 성공(권한 정상). 오류가 나면 맨 아래 "문제 해결" 참고.
   - 참고: 이 계정은 `incoming/`에 **올리기만** 가능해서 `aws s3 ls`로 목록 보기는 제한될 수 있습니다. 업로드가 되면 정상입니다.

---

## C. 컨트롤러 파일 출력 + 자동 업로드 설정 (컨트롤러 PC에서)

### C-1. 컨트롤러가 근태 파일을 로컬 폴더에 만들게 설정
> 정확한 메뉴 위치·화면은 ADT UniWork Pro 버전에 따라 다르니, 아래 항목을 **SK쉴더스/설치 대리점 가이드나 컨트롤러 "근태처리옵션" 화면**을 보며 맞추세요. (핵심 옵션명은 컨트롤러 "근태결과 파일생성"입니다.)

- **근태결과 파일생성** 기능을 **켜기(활성화)**.
- **저장 경로**: 사내 PC의 로컬 폴더로 지정. 예) `C:\adt\export` (없으면 폴더를 먼저 만드세요.)
- **파일명 형식**: 날짜별 `ovrwrk_YYYYMMDD.txt`.
- **필드 구분자**: **탭(Tab)** 권장(우리 기본값). 탭이 안 되면 공백/쉼표도 가능하나, 그 경우 저(개발)에게 알려주시면 클라우드 쪽을 그 구분자에 맞춰 1줄 바꿉니다.
- **컬럼(열) 순서**: 가능하면 아래 순서로. **최소한 사원번호·근무일자·출근·퇴근은 반드시 포함**되어야 합니다.
  `사원번호(e_idno) · 근무일자(d_date, YYYYMMDD) · 출근(HHMMSS) · 퇴근(HHMMSS)` + (있으면) 부서·직급·성명·연장·심야 등.
- **증분 전송**(있으면): "미전송 자료만" 옵션으로 새 기록만 내보내도록.

### C-2. 첫 파일 1개로 시험 (자동화 걸기 전에 꼭)
1. 컨트롤러가 오늘 파일(예 `C:\adt\export\ovrwrk_20260724.txt`)을 하나 만들었는지 확인.
2. 수동으로 한 번 올려봅니다:
   ```
   aws s3 cp C:\adt\export\ovrwrk_20260724.txt s3://mcm-ieps-staging-adt-attendance/incoming/
   ```
3. 클라우드 배치는 **30분마다** 자동으로 읽습니다. 잠시 후 웹앱 **전자결재 → 근태·초과근무 관리** 화면에서 데이터가 잡히는지 확인.
   - 처음엔 직원 자동연결이 안 되어 **미매칭 매핑** 탭에 뜹니다. 거기서 ADT 사번을 직원과 연결하면 됩니다.
   - (급하면 30분 안 기다리고 즉시 실행도 가능 — 아래 "즉시 실행" 참고. 단 이건 개발/관리자가 로컬 PC에서.)

### C-3. 30분마다 자동 업로드 (Windows 작업 스케줄러)
1. 메모장으로 아래 내용을 `C:\adt\upload.bat`로 저장:
   ```
   aws s3 sync C:\adt\export s3://mcm-ieps-staging-adt-attendance/incoming/ --exclude "*" --include "ovrwrk_*.txt"
   ```
   (이 명령은 새로 생기거나 바뀐 `ovrwrk_*.txt`만 올립니다.)
2. **작업 스케줄러(Task Scheduler)** 실행 → **작업 만들기(Create Task)**.
   - **일반** 탭: 이름 `ADT 근태 업로드`, "사용자가 로그인하지 않아도 실행" 선택(가능하면).
   - **트리거(Triggers)** 탭 → 새로 만들기 → "매일" 시작 후 → **"작업을 다음 간격으로 반복: 30분", "기간: 무기한"** 체크.
   - **동작(Actions)** 탭 → 새로 만들기 → 프로그램/스크립트에 `C:\adt\upload.bat` 지정.
   - 확인 후 저장(PC 로그인 비밀번호를 물으면 입력).
3. 이제 30분마다 자동 업로드 → 클라우드가 30분마다 취식 → 화면에 반영됩니다.

---

## (선택) 즉시 실행 — 30분 안 기다리고 바로 처리 (개발/관리자, 로컬 PC·SSO 필요)
S3에 파일이 올라온 뒤 배치를 즉시 한 번 돌리려면(로컬 PC에서 `aws sso login --profile mcm-kesi-staging` 후):
```
aws ecs run-task --cluster mcm-ieps-staging \
  --task-definition mcm-ieps-staging-next --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<public subnet>],securityGroups=[<ecs sg>],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"next","command":["node",".next/adt-ingest.cjs"],"environment":[{"name":"ADT_INGEST_MODE","value":"file"},{"name":"ADT_FILE_S3_BUCKET","value":"mcm-ieps-staging-adt-attendance"},{"name":"ADT_FILE_S3_PREFIX","value":"incoming/"}]}]}' \
  --profile mcm-kesi-staging --region ap-northeast-2
```
(subnet/sg 값은 스케줄과 동일 — 필요하면 개발에게 요청.)

---

## 문제 해결
| 증상 | 원인·조치 |
|---|---|
| 업로드 시 `AccessDenied` | 키/리전 확인(`aws configure` 재실행, 리전 `ap-northeast-2`), 경로가 반드시 `incoming/` 하위인지 확인. |
| 화면에 데이터가 계속 안 뜸 | ①파일이 S3 `incoming/`에 올라갔는지 ②파일명이 `ovrwrk_*.txt`인지 ③30분 경과했는지. |
| **한글(부서·이름)이 깨짐** | 컨트롤러 파일 인코딩이 EUC-KR일 가능성. **파일 1개를 개발에게 전달**하면 클라우드 쪽 디코딩을 EUC-KR로 맞춥니다. |
| 데이터는 뜨는데 **직원 이름이 "미매칭"** | 정상 초기 상태. **근태·초과근무 관리 → 미매칭 매핑** 탭에서 ADT 사번↔직원 연결. |
| 숫자/시간이 이상하게 잘림 | 컬럼 순서·구분자가 우리 기본과 다름. **파일 1줄 샘플을 개발에게 전달**하면 파서를 맞춥니다. |

> 막히는 부분이 있으면 **실제 생성된 txt 파일 1개**를 개발에게 전달해 주세요. 구분자·컬럼순서·인코딩을 실측해 클라우드 쪽을 맞추는 게 가장 빠릅니다.
