# S3 서버측 암호화 명시(PR-P3) — 종전에는 AWS 기본 SSE-S3 에 암묵 의존.
# 정책으로 강제해 두면 설정 드리프트·신규 버킷 복제 시 누락을 막는다.
# 적용: terraform apply -target=aws_s3_bucket_server_side_encryption_configuration.app_data \
#                       -target=aws_s3_bucket_server_side_encryption_configuration.mail_inbound
# (전체 apply 금지 — SES/Route53 drift, docs/converter 메모 참조)

resource "aws_s3_bucket_server_side_encryption_configuration" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "mail_inbound" {
  bucket = aws_s3_bucket.mail_inbound.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}
