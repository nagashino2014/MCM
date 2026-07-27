# ses-mail.tf — 회사 도메인 메일 P0(발송 측): SES 도메인 아이덴티티·DKIM·SPF·Custom MAIL FROM·DMARC·바운스 SNS.
# 리전 = 기본 provider(ap-northeast-2, 발송 리전). 수신(MX/Receipt Rule)은 ses-inbound.tf.
# 설계: docs/company-email-blueprint.md §2. 전부 멱등 — 콘솔에서 이미 수동 검증됐어도 동일 identity/토큰이라 충돌 없음.
#
# ⚠ Terraform 밖(콘솔/Support) 작업 2가지 — apply 로 처리 안 됨:
#   1) SES 프로덕션 액세스(샌드박스 해제): 임의 수신자 발송·쿼터 상향. 승인 지연 있어 즉시 신청.
#   2) DMARC 리포트 주소(var.dmarc_report_email): 인바운드 서기 전엔 수신 가능한 외부 주소로.

# 1) 도메인 아이덴티티 + 검증 TXT(_amazonses)
resource "aws_ses_domain_identity" "main" {
  domain = var.domain_name
}

resource "aws_route53_record" "ses_verification" {
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = "_amazonses.${var.domain_name}"
  type            = "TXT"
  ttl             = 600
  records         = [aws_ses_domain_identity.main.verification_token]
  allow_overwrite = true
}

resource "aws_ses_domain_identity_verification" "main" {
  domain     = aws_ses_domain_identity.main.id
  depends_on = [aws_route53_record.ses_verification]
}

# 2) Easy DKIM — SES 발급 토큰 3개를 CNAME 으로. 수신측 DKIM 서명 검증 통과.
resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_route53_record" "ses_dkim" {
  count           = 3
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = "${aws_ses_domain_dkim.main.dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type            = "CNAME"
  ttl             = 600
  records         = ["${aws_ses_domain_dkim.main.dkim_tokens[count.index]}.dkim.amazonses.com"]
  allow_overwrite = true
}

# 3) SPF — apex TXT. 발신 IP(amazonses) 인가.
# ⚠ apex 에 다른 TXT(도메인 검증 등)가 이미 있으면 SPF 문자열을 그 레코드에 "병합"해야 한다(TXT 다중 SPF 는 무효).
#    _amazonses 검증은 별도 이름이라 apex 와 무관. 현재 apex TXT 부재 전제 — 있으면 allow_overwrite 로 덮이니 확인 후 병합.
resource "aws_route53_record" "spf" {
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = var.domain_name
  type            = "TXT"
  ttl             = 600
  records         = ["v=spf1 include:amazonses.com ~all"]
  allow_overwrite = true
}

# 4) Custom MAIL FROM — Return-Path 를 bounce.koensain.app 으로 정렬(DMARC alignment 핵심).
resource "aws_ses_domain_mail_from" "main" {
  domain                 = aws_ses_domain_identity.main.domain
  mail_from_domain       = "${var.mail_from_subdomain}.${var.domain_name}"
  behavior_on_mx_failure = "UseDefaultValue"
}

# MAIL FROM 서브도메인 MX — feedback-smtp 는 발송 리전 기준.
resource "aws_route53_record" "mail_from_mx" {
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = aws_ses_domain_mail_from.main.mail_from_domain
  type            = "MX"
  ttl             = 600
  records         = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
  allow_overwrite = true
}

# MAIL FROM 서브도메인 SPF.
resource "aws_route53_record" "mail_from_spf" {
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = aws_ses_domain_mail_from.main.mail_from_domain
  type            = "TXT"
  ttl             = 600
  records         = ["v=spf1 include:amazonses.com ~all"]
  allow_overwrite = true
}

# 5) DMARC — 시작은 var.dmarc_policy(=none 관측). rua 리포트 확인 후 quarantine→reject 로 강화.
#    dmarc_report_email 이 비면 rua 없이 정책만 게시(리포트 미수신).
resource "aws_route53_record" "dmarc" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [
    var.dmarc_report_email != "" ?
    "v=DMARC1; p=${var.dmarc_policy}; rua=mailto:${var.dmarc_report_email}; ruf=mailto:${var.dmarc_report_email}; fo=1; adkim=s; aspf=s" :
    "v=DMARC1; p=${var.dmarc_policy}; fo=1; adkim=s; aspf=s"
  ]
  allow_overwrite = true
}

# 6) 바운스/신고(complaint) SNS — 하드바운스·스팸신고를 앱(P2 mail_bounces)이 구독해 발송 억제.
#    SES 계정 평판(반송률<5%·신고율<0.1%) 관리의 기반. 이메일 피드백 포워딩은 비활성(SNS 로 일원화).
resource "aws_sns_topic" "ses_bounce" {
  name = "${local.name}-ses-bounce"
  tags = local.tags
}

resource "aws_sns_topic" "ses_complaint" {
  name = "${local.name}-ses-complaint"
  tags = local.tags
}

resource "aws_ses_identity_notification_topic" "bounce" {
  identity                 = aws_ses_domain_identity.main.domain
  notification_type        = "Bounce"
  topic_arn                = aws_sns_topic.ses_bounce.arn
  include_original_headers = true
}

resource "aws_ses_identity_notification_topic" "complaint" {
  identity                 = aws_ses_domain_identity.main.domain
  notification_type        = "Complaint"
  topic_arn                = aws_sns_topic.ses_complaint.arn
  include_original_headers = true
}

# NOTE: 이메일 피드백 포워딩(바운스/신고를 메일로도 전달) 비활성화는 AWS provider 에 전용 리소스가 없다.
#       중복 알림을 피하려면 SES 콘솔 > Verified identities > koensain.app > Notifications 에서
#       "Email Feedback Forwarding" 을 Disabled 로 (SNS 로 일원화). 필수는 아님.
