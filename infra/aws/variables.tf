variable "project_name" {
  type    = string
  default = "mcm-ieps"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "domain_name" {
  type    = string
  default = "koensain.app"
}

variable "availability_zones" {
  type    = list(string)
  default = ["ap-northeast-2a", "ap-northeast-2c"]
}

variable "db_username" {
  type    = string
  default = "mcm"
}

variable "db_name" {
  type    = string
  default = "mcm"
}

variable "container_image_next" {
  type    = string
  default = "public.ecr.aws/docker/library/node:20-alpine"
}

variable "container_image_backend" {
  type    = string
  default = "public.ecr.aws/docker/library/python:3.11-slim"
}

variable "container_image_worker" {
  type    = string
  default = "public.ecr.aws/docker/library/node:20-bookworm"
}

# 문서 변환 서비스(LibreOffice) — 전자결재 첨부 미리보기용.
variable "container_image_converter" {
  type    = string
  default = "public.ecr.aws/docker/library/python:3.11-slim"
}

# ── 알림/AI 설정(전자결재·공공입찰 알림, AI 요약·사전검토) ──────────────
# 발신 이메일 — SES 검증된 identity 여야 함(koensain.app 도메인 검증 완료).
variable "notify_email_from" {
  type    = string
  default = "no-reply@koensain.app"
}

# 알림 본문의 결재함 링크 베이스 URL(앱 코드 APP_PUBLIC_URL).
variable "app_public_url" {
  type    = string
  default = "https://koensain.app"
}

# 카카오 알림톡(솔라피) — 발신프로필/승인 템플릿 ID. 콘솔 등록 후 tfvars 로 채운다.
# 비어 있으면 앱이 알림톡 발송을 건너뛴다(이메일만 발송). API Key/Secret 은 Secrets Manager.
variable "solapi_kakao_pf_id" {
  type    = string
  default = ""
}

variable "solapi_kakao_template_id" {
  type    = string
  default = ""
}

# SMS 대체발송용 등록 발신번호(선택). 숫자만.
variable "solapi_sender" {
  type    = string
  default = ""
}

# ── 회사 도메인 메일(코넨사인 메일) P0 인프라 ────────────────────────────
# 설계: docs/company-email-blueprint.md §2. 발송(DKIM/SPF/MAIL FROM/DMARC/바운스)은
# ses-mail.tf(서울 리전), 수신(MX/Receipt Rule)은 ses-inbound.tf(지원 리전) 참고.

# Custom MAIL FROM 서브도메인 — Return-Path 정렬(DMARC alignment)용. bounce.koensain.app.
variable "mail_from_subdomain" {
  type    = string
  default = "bounce"
}

# DMARC 집계 리포트(rua) 수신 주소.
# ⚠ 수신(ses-inbound)이 서기 전에는 우리 도메인(dmarc@koensain.app)이 메일을 못 받으므로,
#   초기에는 수신 가능한 외부 주소(예: 관리자 Gmail)를 tfvars 로 넣는다. 인바운드 가동 후 dmarc@ 로 교체.
variable "dmarc_report_email" {
  type    = string
  default = ""
}

# DMARC 정책 — 관측(none) → 격리(quarantine) → 거부(reject) 로 점진 강화(§2.5).
variable "dmarc_policy" {
  type    = string
  default = "none"
  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "dmarc_policy 는 none|quarantine|reject 중 하나여야 합니다."
  }
}

# 수신 MX 컷오버 스위치(P2). 수신 파이프라인(S3·SNS·SQS·Receipt Rule)은 항상 생성하되,
# MX 레코드만 이 플래그로 마지막에 켠다 — MX 가 켜지는 순간 실제 외부 메일이 SES 로 유입되므로
# 파싱 워커(next) 배포 완료 후 true 로 전환한다. SES 수신은 서울(ap-northeast-2) 지원 확인됨(§2.4).
variable "enable_mail_inbound_mx" {
  type    = bool
  default = false
}
