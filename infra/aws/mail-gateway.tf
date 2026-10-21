# 외부 메일 프로그램(아웃룩 등) IMAP/SMTP 게이트웨이 — docs/mail-external-client-plan.md A안.
# 인터넷 → NLB(TLS 993 IMAPS / 465 SMTPS, ACM 인증서로 TLS 종료, PROXY v2 로 원 IP 전달)
#        → Fargate 태스크 1개(next 이미지, 명령만 node .next/mail-gateway.cjs) → DB(mail_*)·S3·SES.
#
# ★ var.enable_mail_gateway(기본 false) 가 켜질 때만 리소스가 생긴다. 스테이징은 전체 apply 금지(CLAUDE.md) —
#   켤 때는 이 파일의 주소만 -target 으로 plan 을 검토한 뒤 적용한다(메일 MX·SES·bastion 변경이 섞이면 중단):
#     terraform plan -var-file=staging.tfvars -var enable_mail_gateway=true \
#       -target=aws_acm_certificate.mail_gateway -target=aws_route53_record.mail_gateway_cert_validation \
#       -target=aws_acm_certificate_validation.mail_gateway -target=aws_security_group.mail_gateway \
#       -target=aws_lb.mail_gateway -target=aws_lb_target_group.mail_gateway_imap -target=aws_lb_target_group.mail_gateway_smtp \
#       -target=aws_lb_listener.mail_gateway_imap -target=aws_lb_listener.mail_gateway_smtp \
#       -target=aws_route53_record.mail_gateway_imap -target=aws_route53_record.mail_gateway_smtp \
#       -target=aws_cloudwatch_log_group.mail_gateway -target=aws_ecs_task_definition.mail_gateway \
#       -target=aws_ecs_service.mail_gateway
#   태스크 정의의 실제 컨테이너 설정(이미지·env·secrets)은 terraform 밖에서 ops/staging-deploy-mail-gateway.ps1 이
#   현재 next 태스크 정의를 복제해 등록한다(next 와 같은 DB 역할·버킷·이미지 태그를 쓴다).
#
# 비용(서울, 상시): NLB 1개 + LCU, Fargate 0.5vCPU/1GB 1태스크. 연결된 클라이언트가 IDLE 로 10초마다 DB 를 조회하므로
# 아웃룩을 켜 둔 PC 가 있는 동안 Aurora 자동 일시정지가 일어나지 않는다.

variable "enable_mail_gateway" {
  type    = bool
  default = false
}

locals {
  mail_gw_count     = var.enable_mail_gateway ? 1 : 0
  mail_gw_imap_host = "imap.${var.domain_name}"
  mail_gw_smtp_host = "smtp.${var.domain_name}"
}

resource "aws_acm_certificate" "mail_gateway" {
  count                     = local.mail_gw_count
  domain_name               = local.mail_gw_imap_host
  subject_alternative_names = [local.mail_gw_smtp_host]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

resource "aws_route53_record" "mail_gateway_cert_validation" {
  for_each = var.enable_mail_gateway ? {
    for dvo in aws_acm_certificate.mail_gateway[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "mail_gateway" {
  count                   = local.mail_gw_count
  certificate_arn         = aws_acm_certificate.mail_gateway[0].arn
  validation_record_fqdns = [for r in aws_route53_record.mail_gateway_cert_validation : r.fqdn]
}

# 태스크 인바운드 — NLB(TLS 종료)는 자기 사설 IP 로 대상에 붙으므로 VPC 대역만 연다.
# 클라이언트 원 IP 는 PROXY v2 헤더로 받는다(실패 잠금·접속기록).
resource "aws_security_group" "mail_gateway" {
  count       = local.mail_gw_count
  name        = "${local.name}-mail-gateway"
  description = "Mail gateway tasks (IMAP/SMTP behind NLB)"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "IMAP from NLB"
    from_port   = 1143
    to_port     = 1143
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  ingress {
    description = "SMTP submission from NLB"
    from_port   = 1465
    to_port     = 1465
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  ingress {
    description = "Health check from NLB"
    from_port   = 8025
    to_port     = 8025
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_lb" "mail_gateway" {
  count                            = local.mail_gw_count
  name                             = "${local.name}-mailgw"
  load_balancer_type               = "network"
  internal                         = false
  subnets                          = aws_subnet.public[*].id
  enable_cross_zone_load_balancing = true

  tags = local.tags
}

resource "aws_lb_target_group" "mail_gateway_imap" {
  count                = local.mail_gw_count
  name                 = "${local.name}-mailgw-imap"
  port                 = 1143
  protocol             = "TCP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  proxy_protocol_v2    = true
  deregistration_delay = 30

  health_check {
    protocol            = "HTTP"
    port                = "8025"
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = local.tags
}

resource "aws_lb_target_group" "mail_gateway_smtp" {
  count                = local.mail_gw_count
  name                 = "${local.name}-mailgw-smtp"
  port                 = 1465
  protocol             = "TCP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  proxy_protocol_v2    = true
  deregistration_delay = 30

  health_check {
    protocol            = "HTTP"
    port                = "8025"
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = local.tags
}

resource "aws_lb_listener" "mail_gateway_imap" {
  count             = local.mail_gw_count
  load_balancer_arn = aws_lb.mail_gateway[0].arn
  port              = 993
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.mail_gateway[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.mail_gateway_imap[0].arn
  }
}

resource "aws_lb_listener" "mail_gateway_smtp" {
  count             = local.mail_gw_count
  load_balancer_arn = aws_lb.mail_gateway[0].arn
  port              = 465
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.mail_gateway[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.mail_gateway_smtp[0].arn
  }
}

resource "aws_route53_record" "mail_gateway_imap" {
  count   = local.mail_gw_count
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.mail_gw_imap_host
  type    = "A"

  alias {
    name                   = aws_lb.mail_gateway[0].dns_name
    zone_id                = aws_lb.mail_gateway[0].zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "mail_gateway_smtp" {
  count   = local.mail_gw_count
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.mail_gw_smtp_host
  type    = "A"

  alias {
    name                   = aws_lb.mail_gateway[0].dns_name
    zone_id                = aws_lb.mail_gateway[0].zone_id
    evaluate_target_health = false
  }
}

resource "aws_cloudwatch_log_group" "mail_gateway" {
  count             = local.mail_gw_count
  name              = "/ecs/${local.name}/mail-gateway"
  retention_in_days = 30
  tags              = local.tags
}

# 최초 등록용 골격 — 이후 리비전은 ops/staging-deploy-mail-gateway.ps1 이 next 태스크 정의를 복제해 등록한다.
# 역할은 next 와 같다(DB 시크릿·app_data 버킷·수신 원문 읽기·SES 발송 권한이 이미 있다).
resource "aws_ecs_task_definition" "mail_gateway" {
  count                    = local.mail_gw_count
  family                   = "${local.name}-mail-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution_next.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "mail-gateway"
      image     = var.container_image_next
      essential = true
      command   = ["node", ".next/mail-gateway.cjs"]
      portMappings = [
        { containerPort = 1143, protocol = "tcp" },
        { containerPort = 1465, protocol = "tcp" },
        { containerPort = 8025, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket },
        { name = "MAIL_INBOUND_BUCKET", value = aws_s3_bucket.mail_inbound.bucket },
        { name = "MAIL_GW_HOSTNAME", value = local.mail_gw_smtp_host },
        { name = "MAIL_GW_PROXY_PROTOCOL", value = "1" },
        { name = "APP_PUBLIC_URL", value = var.app_public_url },
        { name = "PGHOST", value = aws_rds_cluster.main.endpoint },
        { name = "PGPORT", value = "5432" },
        { name = "PGDATABASE", value = var.db_name },
        { name = "PGSSL", value = "require" },
        { name = "PGSSL_REJECT_UNAUTHORIZED", value = "true" },
        { name = "MCM_DB_ROLE_REQUIRED", value = "true" },
        { name = "MCM_DB_EXPECTED_ROLE", value = var.db_app_role_name }
      ]
      secrets = [
        { name = "PGUSER", valueFrom = "${aws_secretsmanager_secret.db_app.arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${aws_secretsmanager_secret.db_app.arn}:password::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.mail_gateway[0].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "mail-gateway"
        }
      }
    }
  ])

  tags = local.tags

  lifecycle {
    ignore_changes = [container_definitions, execution_role_arn, task_role_arn]
  }
}

resource "aws_ecs_service" "mail_gateway" {
  count                             = local.mail_gw_count
  name                              = "${local.name}-mail-gateway"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.mail_gateway[0].arn
  desired_count                     = 1
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  # next·converter 와 같은 public subnet + public IP(NAT 없음). DB 접근은 ecs SG, NLB 인바운드는 mail_gateway SG.
  network_configuration {
    assign_public_ip = true
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id, aws_security_group.mail_gateway[0].id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.mail_gateway_imap[0].arn
    container_name   = "mail-gateway"
    container_port   = 1143
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.mail_gateway_smtp[0].arn
    container_name   = "mail-gateway"
    container_port   = 1465
  }

  depends_on = [aws_lb_listener.mail_gateway_imap, aws_lb_listener.mail_gateway_smtp]
  tags       = local.tags

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

output "mail_gateway_endpoints" {
  value = var.enable_mail_gateway ? {
    imap = "${local.mail_gw_imap_host}:993 (SSL/TLS)"
    smtp = "${local.mail_gw_smtp_host}:465 (SSL/TLS)"
  } : null
}
