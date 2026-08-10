data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.name}-ecs-execution-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.app.arn,
        aws_rds_cluster.main.master_user_secret[0].secret_arn
      ]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "app_access" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.app_data.arn,
      "${aws_s3_bucket.app_data.arn}/*"
    ]
  }

  statement {
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes"
    ]
    resources = [aws_sqs_queue.jobs.arn, aws_sqs_queue.jobs_dlq.arn]
  }

  # 코넨사인 메일 수신(P2) — next tick 이 수신 큐를 폴링하고 원문 MIME 을 수신 버킷에서 읽는다.
  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl"
    ]
    resources = [aws_sqs_queue.mail_inbound.arn]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.mail_inbound.arn}/*"]
  }

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.app.arn,
      aws_rds_cluster.main.master_user_secret[0].secret_arn
    ]
  }

  # OCR 백엔드 on-demand 기동: 파싱 요청 시 next 가 backend 서비스를 desired=1 로 올린다.
  statement {
    actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  # 공공입찰 매칭 알림 메일(SES) — 발신 주소는 BID_NOTIFY_EMAIL_FROM env(검증된 identity 필요).
  statement {
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "app_access" {
  name   = "${local.name}-app-access"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.app_access.json
}

resource "aws_ecs_task_definition" "next" {
  family                   = "${local.name}-next"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name         = "next"
      image        = var.container_image_next
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket },
        { name = "MCM_JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
        { name = "MCM_JOB_QUEUE_MODE", value = "sqs" },
        { name = "MCM_EXTRACTION_BACKEND_URL", value = "http://backend.local:8001" },
        # 전자결재 첨부 미리보기 — 오피스·hwpx 를 PDF 로 변환하는 경량 서비스(converter-service.tf)
        { name = "MCM_CONVERTER_URL", value = "http://converter.local:8080" },
        { name = "PGHOST", value = aws_rds_cluster.main.endpoint },
        { name = "PGPORT", value = "5432" },
        { name = "PGDATABASE", value = var.db_name },
        { name = "ADMIN_PASSWORD_SYNC_ON_BOOT", value = "true" },
        # 알림(전자결재·공공입찰) — 발신 이메일(SES 검증 identity) + 결재함 링크 베이스 URL
        { name = "BID_NOTIFY_EMAIL_FROM", value = var.notify_email_from },
        { name = "APP_PUBLIC_URL", value = var.app_public_url },
        # 카카오 알림톡(솔라피) — 발신프로필/템플릿 ID(비면 알림톡 건너뜀). API 자격증명은 secrets.
        { name = "SOLAPI_KAKAO_PF_ID", value = var.solapi_kakao_pf_id },
        { name = "SOLAPI_KAKAO_TEMPLATE_ID", value = var.solapi_kakao_template_id },
        { name = "SOLAPI_SENDER", value = var.solapi_sender }
      ]
      secrets = [
        { name = "AUTH_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:AUTH_SECRET::" },
        { name = "ADMIN_USERNAME", valueFrom = "${aws_secretsmanager_secret.app.arn}:ADMIN_USERNAME::" },
        { name = "ADMIN_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app.arn}:ADMIN_PASSWORD::" },
        { name = "PGUSER", valueFrom = "${aws_rds_cluster.main.master_user_secret[0].secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${aws_rds_cluster.main.master_user_secret[0].secret_arn}:password::" },
        # ⚠ 아래 3개 JSON 키는 Secrets Manager 시크릿(mcm-ieps-staging/app)에 먼저 넣은 뒤 apply 할 것.
        #    키가 없으면 ECS 태스크가 시크릿 주입 실패로 기동하지 못한다.
        #    - SOLAPI_API_KEY / SOLAPI_API_SECRET : 솔라피 알림톡 API 자격증명
        #    - ANTHROPIC_API_KEY : AI 요약(AX-P2)·AI 검토(AX-P3)용
        { name = "SOLAPI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:SOLAPI_API_KEY::" },
        { name = "SOLAPI_API_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:SOLAPI_API_SECRET::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:ANTHROPIC_API_KEY::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.next.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "next"
        }
      }
    }
  ])

  tags = local.tags

  # 앱 이미지/태스크 정의는 terraform 밖(register-task-definition)에서 배포한다.
  # terraform 이 container_definitions(이미지·정규화 필드)를 되돌리지 않도록 무시.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 8192
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name         = "backend"
      image        = var.container_image_backend
      essential    = true
      portMappings = [{ containerPort = 8001, protocol = "tcp" }]
      environment = [
        { name = "DOCKER_ENV", value = "true" },
        { name = "OCR_USE_GPU", value = "false" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "backend"
        }
      }
    }
  ])

  tags = local.tags

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 3072
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = var.container_image_worker
      essential = true
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket },
        { name = "MCM_JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
        { name = "IEPS_BACKEND_URL", value = "http://backend.local:8001" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])

  tags = local.tags

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "next" {
  name            = "${local.name}-next"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.next.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # NAT Gateway 제거를 위해 public subnet + public IP 로 배치.
  # 아웃바운드는 IGW 직결. 인바운드는 ecs SG 가 ALB(3000)/self(8001)만 허용해 안전.
  network_configuration {
    assign_public_ip = true
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.next.arn
    container_name   = "next"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
  tags       = local.tags

  # 배포는 terraform 밖에서 새 task def 리비전 등록 + update-service 로 한다.
  # terraform 이 실행 중 서비스의 task_definition 을 자기 리비전으로 되돌리지 않도록 무시.
  # desired_count 도 무시: staging-stop/start.ps1 등으로 수동 0↔1 조절한 값이
  # terraform apply 후에도 유지되도록 한다(비용 절감 on-demand 토글).
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
