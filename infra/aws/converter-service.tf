# 문서 변환 서비스(converter) — 전자결재 첨부(hwpx·docx·xlsx·pptx)를 PDF 로 변환한다.
# OCR 백엔드는 비용 때문에 평소 desired=0 이라 변환에 쓸 수 없어, LibreOffice 만 담은
# 경량 서비스로 분리했다(이미지 ~1.5GB, 0.5vCPU/1GB 상시). 접근은 VPC 내부 converter.local 뿐.

resource "aws_ecr_repository" "converter" {
  name                 = "${local.name}-converter"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "converter" {
  name              = "/ecs/${local.name}/converter"
  retention_in_days = 30
  tags              = local.tags
}

# `converter` 서비스 → `converter.local` A 레코드(backend 와 같은 네임스페이스).
resource "aws_service_discovery_service" "converter" {
  name = "converter"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = local.tags
}

resource "aws_ecs_task_definition" "converter" {
  family                   = "${local.name}-converter"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # LibreOffice 변환은 짧고 간헐적 — 최소 사양으로 두고 느리면 올린다.
  cpu                = 512
  memory             = 1024
  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name         = "converter"
      image        = var.container_image_converter
      essential    = true
      portMappings = [{ containerPort = 8080, protocol = "tcp" }]
      environment = [
        { name = "AWS_REGION", value = var.aws_region }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.converter.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "converter"
        }
      }
    }
  ])

  tags = local.tags

  # 배포는 terraform 밖(태스크 정의 새 리비전 등록 + update-service)에서 처리.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "converter" {
  name            = "${local.name}-converter"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.converter.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # NAT Gateway 없는 구성 — public subnet + public IP(next·backend 와 동일).
  network_configuration {
    assign_public_ip = true
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.converter.arn
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
