# 야간 DART 신호 전량 수집 배치.
# EventBridge(cron) → ECS RunTask(next 이미지 재사용, command override로 배치 엔트리 실행).
# 배치 엔트리는 Dockerfile builder에서 esbuild 로 .next/intel-batch.cjs 로 번들됨.
# next task def env(PG*·DART_API_KEY·DART_HTTPS_PROXY)를 그대로 상속.

data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_event_rule" "intel_batch" {
  name                = "${local.name}-intel-batch"
  description         = "야간 DART 신호 전량 수집(모집단 역전)"
  schedule_expression = "cron(0 18 * * ? *)" # UTC 18:00 = KST 03:00
  tags                = local.tags
}

resource "aws_iam_role" "intel_batch_events" {
  name = "${local.name}-intel-batch-events"
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

resource "aws_iam_role_policy" "intel_batch_events" {
  name = "${local.name}-intel-batch-events"
  role = aws_iam_role.intel_batch_events.id
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
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.ecs_task.arn, aws_iam_role.ecs_task_execution.arn]
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "intel_batch" {
  rule     = aws_cloudwatch_event_rule.intel_batch.name
  arn      = aws_ecs_cluster.main.arn
  role_arn = aws_iam_role.intel_batch_events.arn

  ecs_target {
    # revision 생략한 family ARN → 최신 ACTIVE 리비전(앱 배포로 갱신되는 next 리비전) 사용
    task_definition_arn = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name}-next"
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      subnets          = aws_subnet.public[*].id
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = true
    }
  }

  # next 컨테이너 커맨드를 배치 엔트리로 오버라이드(서버 대신 배치 실행 후 종료)
  input = jsonencode({
    containerOverrides = [{
      name    = "next"
      command = ["node", ".next/intel-batch.cjs"]
    }]
  })
}
