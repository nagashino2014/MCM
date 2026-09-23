# 스테이징 Terraform state 운영 경계

권위 있는 state는 `s3://mcm-ieps-staging-tfstate-195748745315-apne2/mcm-ieps/staging/terraform.tfstate`이다. Terraform 1.9.8은 `mcm-ieps-staging-terraform-lock` DynamoDB 테이블로 이를 잠근다. 기대 계보는 `748db01c-6b2f-ba63-b769-10789f067cad`이다.

## 사용 금지된 옛 사본

- `C:\CodingProject\MCM\infra\aws\terraform.tfstate`
- `C:\CodingProject\MCM\infra\aws\terraform.tfstate.backup`
- `C:\CodingProject\MCM\infra\aws\terraform.tfstate.1779267571.backup`
- `C:\Users\nagas\Documents\MCM\tmp\finance-r0b-task-revision-20260923\tf-plan-config\terraform.tfstate`
- 저장된 옛 계획: `C:\Users\nagas\Documents\MCM\tmp\finance-r0b-task-revision-20260923\terraform-target-plan-v2.bin`

이 경로에서는 Terraform 명령을 실행하지 않는다. 옛 계획도 적용하지 않는다. 위 사본과 계획은 다른 작업과 증거 보존을 위해 그대로 두며, 권위 있는 state로 사용하지 않는다. 특히 로컬 state가 있는 폴더에서 대화형 `init`에 이전 질문이 나오면 **no**를 선택하고 중지한다. `-migrate-state`와 `-force-copy`를 사용하지 않는다. `-reconfigure`만으로는 옛 state가 S3를 덮는 일을 막지 못한다.

## 이후 계획·적용의 선행 조건

1. 최신 main의 `infra/aws/backend.tf`를 가진 작업 폴더를 쓴다. `git fetch origin` 후 `HEAD == origin/main`과 깨끗한 작업 트리를 확인한다. 작업 폴더에 `terraform.tfstate*` 또는 `terraform.tfstate.d`가 없어야 하며 `TF_DATA_DIR`은 설정하지 않는다. 적용 환경에 `TF_CLI_CONFIG_FILE`을 설정하거나 Terraform CLI 설정에 `dev_overrides`를 두지 않는다. AWS 프로필은 `AWS_PROFILE` 환경변수로 지정하고, `-backend-config=profile=…`는 사용하지 않는다. `init`은 입력을 받지 않는 방식(`-input=false`)으로만 실행한다.
2. S3 최신 객체 버전 ID를 별도 작업 기록에 남긴다. `ops/staging-check-terraform-state.ps1`에 그 버전을 전달해 계정, backend, 기본 workspace, 계보와 S3 버전 불변을 확인한다. 다른 버전이면 원인을 조사하기 전에는 계속하지 않는다.
3. R0B 대상 계획은 적용 직전에 검증된 작업 폴더에서 새로 만들고 **작업 트리 밖의 새 증거 폴더**에 저장한다. `ops/staging-check-r0b-terraform-plan.ps1`로 저장된 계획의 내장 backend 종류·위치, state 계보·일련번호, 계획에 포함된 HCL 원본 파일과 provider 잠금 파일, 변수, 정책 본문, 주소·동작·기존 정책 import를 검사한다. backend의 bucket·key·region·잠금 테이블은 값을 정확히 비교하고, 암호화와 단일 허용 계정 설정을 필수로 요구하며, 검토하지 않은 설정에 값이 있으면 거절한다. 검토한 IAM 관련 HCL 여덟 파일과 `versions.tf`, `.terraform.lock.hcl`의 해시도 고정한다. 작업 폴더와 저장 계획에 Terraform override 파일(`override.tf`, `*_override.tf`와 각 `.tf.json`)이 있으면 거절한다. 이 검사는 최신 main과 깨끗한 작업 트리 및 state 확인도 요구하며, 허용 목록 밖·삭제·교체·메일·bastion·ECS 서비스·스케줄 변경이 섞이면 거절한다. Terraform 1.9.8 계획 내부 형식이 달라져 backend를 읽지 못하면 실패로 중단한다. 현재 전체 계획의 추가 17·변경 7·삭제 4는 적용 대상이 아니다.
4. 적용 바로 전 2번과 3번 검사를 반복하고 검증한 **그 계획 파일**만 사용한다. 적용 후 S3 버전 ID와 state 일련번호를 새 작업 기록에 갱신한다. 이전 버전 ID를 다음 적용의 기대값으로 재사용하지 않는다.

**잔여 위험 및 수용(2026-09-23):** 검사기는 `init` 이후 호출될 때만 보호한다. 옛 state가 있는 폴더에서 `init` 질문에 yes로 답하거나 `-force-copy`를 쓰면 S3 state가 옛 사본으로 교체될 수 있다. 이는 절차 통제이며 S3 버전 관리로 복구할 수 있지만, 복구에는 사람이 개입해야 한다. 사용자는 이 잔여 위험을 main 통합 조건으로 수용했다. 옛 폴더에 접근하는 모든 운영자에게 사용 금지를 공유해야 한다. AWS에만 있고 state에는 없던 `facility-quality-worker-start` 정책은 `facility-quality-worker-import.tf`의 선언적 import로 이후 R0B 적용 시 편입할 계획이며, 해당 적용 전에는 state를 변경하지 않는다.
