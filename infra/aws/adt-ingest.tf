# ADT 근태 인제스트 배치 (웹 업로드 방식의 보조 배치).
# 근태 데이터의 주 수집 경로는 관리자 웹 업로드(/approval/attendance → /api/approval/attendance/upload)로,
# 엑셀 업로드 시 즉시 파싱·산정된다. 이 스케줄은 "직원 매핑 후 미처리 스테이징(processed=false) 재정규화"만 담당한다.
# (사내→클라우드 S3 sync 경로는 웹 업로드 채택으로 폐기 — 관련 버킷/업로드 IAM 은 이 파일에서 제거됨.)
# next task def의 mcm_app DB 역할과 실제 역할 검사를 그대로 상속한다.
# 별도 worker/collector 역할이 아니며 mode=db(스테이징 재처리)만 오버라이드한다.

resource "aws_cloudwatch_event_rule" "adt_ingest" {
  name                = "${local.name}-adt-ingest"
  description         = "ADT 근태 미처리 스테이징 재정규화(매핑 후 반영). 주 경로는 웹 업로드."
  schedule_expression = "rate(1 hour)"
  tags                = local.tags
}

resource "aws_iam_role" "adt_ingest_events" {
  name = "${local.name}-adt-ingest-events"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "adt_ingest_events" {
  name = "${local.name}-adt-ingest-events"
  role = aws_iam_role.adt_ingest_events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = ["arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name}-next:*"]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = concat(
          [aws_iam_role.ecs_task.arn, aws_iam_role.ecs_task_execution_next.arn],
          var.r0b_transition_allow_legacy_roles ? [aws_iam_role.ecs_task_execution.arn] : []
        )
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "adt_ingest" {
  rule     = aws_cloudwatch_event_rule.adt_ingest.name
  arn      = aws_ecs_cluster.main.arn
  role_arn = aws_iam_role.adt_ingest_events.arn

  ecs_target {
    # 검증·안정화 전 신규 family revision을 실행하지 않도록 revision을 고정한다.
    # R0B 전환 도구가 Next 서비스 안정화 뒤 이 target을 같은 revision으로 갱신한다.
    task_definition_arn = var.scheduled_next_task_definition_arn
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = aws_subnet.public[*].id
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = true
    }
  }

  # next 컨테이너 커맨드를 배치 엔트리로 오버라이드 — db 모드(미처리 스테이징 재정규화).
  input = jsonencode({
    containerOverrides = [{
      name        = "next"
      command     = ["node", ".next/adt-ingest.cjs"]
      environment = [{ name = "ADT_INGEST_MODE", value = "db" }]
    }]
  })

  # Next/worker revision 전환 도구가 검증과 서비스 안정화 뒤 정확한 revision ARN을
  # 기록한다. 일반 terraform apply가 그 포인터를 과거 state revision으로 되돌리지 않는다.
  lifecycle {
    ignore_changes = [ecs_target[0].task_definition_arn]

    precondition {
      condition     = can(regex("^arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name}-next:[1-9][0-9]*$", var.scheduled_next_task_definition_arn))
      error_message = "scheduled_next_task_definition_arn must identify this account, region, and Next family with an explicit revision."
    }
  }
}
