# ses-mail-com.tf — 추가 발신 도메인(koensain.com) 1단계: SES 도메인 아이덴티티·DKIM·Custom MAIL FROM·바운스 SNS.
# 리전 = 기본 provider(ap-northeast-2, 발송 리전). koensain.app 쪽 발송은 ses-mail.tf, 수신은 ses-inbound.tf.
# 설계: docs/company-email-com-domain-phase1.md §4.
#
# ★ koensain.com 의 DNS 는 Wix(ns10/ns11.wixdns.net)라 Route53 레코드를 만들지 않는다.
#   apply 후 output extra_send_domain_dns_records 의 값을 Wix DNS 관리 화면에 직접 입력한다.
# ★ MX·apex SPF 는 건드리지 않는다 — 수신은 아마란스(mail.bizboxa.com) 유지, 다우오피스 SPF 도 계속 사용.
# ⚠ aws_ses_domain_identity_verification 은 두지 않는다 — Wix 입력 전에는 apply 가 검증 대기(최대 45분)로 멈춘다.
#   검증 상태는 `aws sesv2 get-email-identity --email-identity koensain.com` 으로 확인.
# ⚠ 스테이징 전체 apply 금지 — 이 파일의 주소만 -target 으로 적용한다(ops/README.md 배포 경계).

locals {
  extra_mail_enabled = var.extra_send_domain != ""
  extra_mail_from    = "${var.extra_mail_from_subdomain}.${var.extra_send_domain}"
}

# 1) 도메인 아이덴티티(검증 토큰 → Wix TXT _amazonses)
resource "aws_ses_domain_identity" "extra" {
  count  = local.extra_mail_enabled ? 1 : 0
  domain = var.extra_send_domain
}

# 2) Easy DKIM — 토큰 3개를 Wix CNAME 으로. DMARC 정렬은 이 DKIM(d=koensain.com)으로 통과한다.
resource "aws_ses_domain_dkim" "extra" {
  count  = local.extra_mail_enabled ? 1 : 0
  domain = aws_ses_domain_identity.extra[0].domain
}

# 3) Custom MAIL FROM — Return-Path 를 bounce.koensain.com 으로. SPF 는 이 서브도메인 레코드로 검사되므로
#    apex SPF(조회 9/10회)에 amazonses 를 넣지 않아도 SPF·DMARC 가 통과한다.
resource "aws_ses_domain_mail_from" "extra" {
  count                  = local.extra_mail_enabled ? 1 : 0
  domain                 = aws_ses_domain_identity.extra[0].domain
  mail_from_domain       = local.extra_mail_from
  behavior_on_mx_failure = "UseDefaultValue"
}

# 4) 바운스/신고 — koensain.app 과 같은 SNS 토픽으로 일원화(ses-mail.tf).
resource "aws_ses_identity_notification_topic" "extra_bounce" {
  count                    = local.extra_mail_enabled ? 1 : 0
  identity                 = aws_ses_domain_identity.extra[0].domain
  notification_type        = "Bounce"
  topic_arn                = aws_sns_topic.ses_bounce.arn
  include_original_headers = true
}

resource "aws_ses_identity_notification_topic" "extra_complaint" {
  count                    = local.extra_mail_enabled ? 1 : 0
  identity                 = aws_ses_domain_identity.extra[0].domain
  notification_type        = "Complaint"
  topic_arn                = aws_sns_topic.ses_complaint.arn
  include_original_headers = true
}

# Wix 에 입력할 레코드. host 는 Wix 호스트명 칸에 넣는 전체 이름.
# DMARC 는 관측(p=none)·relaxed 로 시작 — koensain.com 은 아마란스(DKIM 없음, SPF 정렬)도 함께 발신한다.
output "extra_send_domain_dns_records" {
  value = local.extra_mail_enabled ? concat(
    [for t in aws_ses_domain_dkim.extra[0].dkim_tokens : {
      host  = "${t}._domainkey.${var.extra_send_domain}"
      type  = "CNAME"
      value = "${t}.dkim.amazonses.com"
    }],
    [
      {
        host  = "_amazonses.${var.extra_send_domain}"
        type  = "TXT"
        value = aws_ses_domain_identity.extra[0].verification_token
      },
      {
        host  = local.extra_mail_from
        type  = "MX"
        value = "10 feedback-smtp.${var.aws_region}.amazonses.com"
      },
      {
        host  = local.extra_mail_from
        type  = "TXT"
        value = "v=spf1 include:amazonses.com ~all"
      },
      {
        host = "_dmarc.${var.extra_send_domain}"
        type = "TXT"
        value = var.dmarc_report_email != "" ? (
          "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_email}; fo=1; adkim=r; aspf=r"
        ) : "v=DMARC1; p=none; fo=1; adkim=r; aspf=r"
      },
    ]
  ) : []
}
