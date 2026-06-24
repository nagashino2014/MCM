# 내부 서비스용 프라이빗 DNS 네임스페이스(`*.local`).
# Next/Worker 태스크가 `http://backend.local:8001` 로 OCR 백엔드에 접근하기 위함.
resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "local"
  description = "Private DNS namespace for ${local.name} internal services"
  vpc         = aws_vpc.main.id
  tags        = local.tags
}

# `backend` 서비스 → `backend.local` A 레코드. ECS 서비스가 태스크 IP 를 자동 등록.
resource "aws_service_discovery_service" "backend" {
  name = "backend"

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

# OCR 추출 백엔드(FastAPI) 상시 실행 서비스.
# 기존 `aws_security_group.ecs` 는 8001 self-ingress 가 이미 있어 Next 태스크가 접근 가능.
resource "aws_ecs_service" "backend" {
  name            = "${local.name}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    assign_public_ip = false
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.backend.arn
  }

  tags = local.tags

  # 배포는 terraform 밖에서 처리. task_definition 되돌림 방지.
  lifecycle {
    ignore_changes = [task_definition]
  }
}
