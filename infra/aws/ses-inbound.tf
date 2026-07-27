# ses-inbound.tf — 회사 도메인 메일 P2(수신 측): 수신 버킷·SNS·SQS·Receipt Rule·MX.
# ✅ SES 수신은 서울(ap-northeast-2) 지원 확인 → 발송과 동일 리전, 크로스리전/provider alias 불필요.
# 흐름: koensain.app 수신 → SES Receipt Rule(S3 원문저장 + SNS 통지) → SNS→SQS → next 앱 tick 이 파싱.
# 설계: docs/company-email-blueprint.md §2.4, §4-P2.
#
# ★ 수신 인프라(버킷/SNS/SQS/Rule)는 항상 생성한다. 단 MX 는 var.enable_mail_inbound_mx 로 마지막에 켠다
#   (MX 가 켜지는 순간 실제 외부 메일 유입 시작 → 파싱 워커 배포 후 전환).

# 수신 원문 MIME 저장 버킷(90일 만료 — 파싱 후 앱 DB 가 정본).
resource "aws_s3_bucket" "mail_inbound" {
  bucket = "${local.name}-mail-inbound"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "mail_inbound" {
  bucket                  = aws_s3_bucket.mail_inbound.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "mail_inbound" {
  bucket = aws_s3_bucket.mail_inbound.id
  rule {
    id     = "expire-raw"
    status = "Enabled"
    filter { prefix = "inbound/" }
    expiration { days = 90 }
  }
}

# SES 가 이 버킷에 원문을 PutObject 하도록 허용(계정 한정).
resource "aws_s3_bucket_policy" "mail_inbound" {
  bucket = aws_s3_bucket.mail_inbound.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.mail_inbound.arn}/inbound/*"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

# 수신 통지 SNS + SQS(next 앱 tick 이 폴링). DLQ 로 독성 메시지 격리.
resource "aws_sns_topic" "mail_inbound" {
  name = "${local.name}-mail-inbound"
  tags = local.tags
}

resource "aws_sqs_queue" "mail_inbound_dlq" {
  name                      = "${local.name}-mail-inbound-dlq"
  message_retention_seconds = 1209600
  tags                      = local.tags
}

resource "aws_sqs_queue" "mail_inbound" {
  name                       = "${local.name}-mail-inbound"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 1209600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.mail_inbound_dlq.arn
    maxReceiveCount     = 5
  })
  tags = local.tags
}

# SNS → SQS. raw_message_delivery=true 로 SQS 본문 = SES 수신 통지 JSON 그대로(SNS 봉투 제거).
resource "aws_sns_topic_subscription" "mail_inbound_to_sqs" {
  topic_arn            = aws_sns_topic.mail_inbound.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.mail_inbound.arn
  raw_message_delivery = true
}

resource "aws_sqs_queue_policy" "mail_inbound" {
  queue_url = aws_sqs_queue.mail_inbound.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSNSSend"
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.mail_inbound.arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_sns_topic.mail_inbound.arn }
      }
    }]
  })
}

# SES Receipt Rule Set(리전당 1개 활성) + 규칙: 도메인 수신 → S3 저장 + SNS 통지 + 스팸/바이러스 스캔.
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${local.name}-inbound"
}

resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

resource "aws_ses_receipt_rule" "store" {
  name          = "store-and-notify"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = [var.domain_name]
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name       = aws_s3_bucket.mail_inbound.id
    object_key_prefix = "inbound/"
    topic_arn         = aws_sns_topic.mail_inbound.arn
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.mail_inbound]
}

# MX — koensain.app 수신을 서울 SES 수신 endpoint 로. ⚠ 이 레코드가 생기면 실제 수신 시작(파싱 워커 배포 후 켤 것).
resource "aws_route53_record" "mx" {
  count           = var.enable_mail_inbound_mx ? 1 : 0
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = var.domain_name
  type            = "MX"
  ttl             = 600
  records         = ["10 inbound-smtp.${var.aws_region}.amazonaws.com"]
  allow_overwrite = true
}
