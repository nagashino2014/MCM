# 재무 SQL 스테이징 재개 절차 (검토용)

이 절차는 2026-09-22에 **226~232만 커밋된 스테이징**을 출발점으로 한다. 233은 롤백됐고 243도 아직 없다. 수정 후보가 main에 통합되고 독립 검토가 끝나기 전에는 실행하지 않는다. Next 배포 금지도 유지한다.

## 적용 전 읽기 검사

- Next는 기존 revision 623으로 정상 실행 중이고, 회계 유지보수 SSM 표식이 없어야 한다.
- `yearend_tax_params(2025)` 행이 있어야 한다. 2026-09-22 읽기 검사에서는 있었다.
- `to_regclass('card_tax_reviews')`와 `to_regclass('yearend_rule_policies')`가 모두 NULL인지 확인한다. 이 둘은 243·242가 아직 적용되지 않았다는 재개 출발점의 확인이다.
- SQL 260의 카드번호 사전검사와 동일한 조건에서 `invalid_number`, `formatted_number`, `duplicate_registry_token`, 카드 ID 간 중복 원천이 모두 0이어야 한다. 2026-09-22에는 0이었다.
- ADT 매시 25분과 intel 03:00 KST를 피한다. 이 절차 동안 다른 스테이징 배포·Terraform 적용을 진행하지 않는다.

## 남은 SQL 순서

243이 233보다 먼저 와야 한다. 한 번의 `-AccountingMaintenance` 호출에 아래 **21개 파일을 표시한 순서 그대로** 전달한다. 226~232는 이미 적용됐으므로 다시 넣지 않는다.

```powershell
$financeFiles = @(
  '243_card_tax_reviews.sql',
  '233_vat_followup_reviews.sql',
  '234_vat_finalization_boundary.sql',
  '235_vat_taxpayer_boundary.sql',
  '236_vat_followup_consumption.sql',
  '237_vat_post_return_v2.sql',
  '238_payroll_tax_review.sql',
  '239_labor_signed_snapshot.sql',
  '240_r1_definition_prerequisites.sql',
  '241_recognition_reviews.sql',
  '242_yearend_rule_policies.sql',
  '244_supply_review_records.sql',
  '245_supply_document_registry.sql',
  '247_supply_same_reviews.sql',
  '255_supply_group_reviews.sql',
  '256_supply_group_access.sql',
  '257_supply_vat_consumption.sql',
  '258_supply_vat_registry_identity.sql',
  '260_card_identity_currentness.sql',
  '263_journal_use.sql',
  '264_document_builtin_binding.sql'
)
.\infra\aws\ops\staging-apply-migrations.ps1 -Files $financeFiles -AccountingMaintenance
```

이 호출은 파일 단위로 커밋한다. 도중에 실패하면 서비스 복구와 표식을 확인하고 **Next를 배포하지 않는다**. 원인과 마지막으로 커밋된 파일을 확인한 뒤 실패한 파일부터 재개한다. 처음부터 28개를 재적용하지 않는다. 240의 정의 검사 함수가 설치되면 232~237은 앞머리에서 55000으로 재실행을 거절한다. 이미 적용된 232~237은 재개 목록에 다시 넣지 않는다.

## 적용 후

적용 스크립트가 일곱 정의 검사(`supply`, `document`, `same`, `group`, `vat`, `recognition`, `journal`)를 모두 마쳤는지 확인한다. 별도 연결에서도 일곱 검사를 다시 확인하고, 서비스·스케줄·유지보수 표식 상태가 정상인지 확인한다. 성공한 경우에만 통합 main의 Next를 빌드·배포하고 급여·카드·부가세·전표 경로를 확인한다. ADT·intel 배치는 revision 618에 남는다는 경고와 함께 `-AcknowledgePinnedScheduleLag -Wait`를 사용한다.

설치 후 검사가 실패했다면 앞선 SQL은 이미 파일별로 커밋된 상태다. Next를 배포하지 말고 마지막 성공 파일과 실패 원인을 확인한 뒤 재개 순서를 다시 결정한다.

이 문서는 운영 명령 초안이다. 실제 적용 승인이나 전체 설치 검증 완료를 뜻하지 않는다.
