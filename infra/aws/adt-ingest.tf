# ADT 근태 인제스트 배치.
# EventBridge(주기) → ECS RunTask(next 이미지 재사용, command override로 .next/adt-ingest.cjs 실행).
# 배치 엔트리는 Dockerfile builder 의 esbuild(build-batch.mjs)로 번들됨.
# next task def env(PG*)를 그대로 상속. DB 모드(컨트롤러가 스테이징에 직접 INSERT → 이 배치가 주기 정규화).
#
# 주기는 컨트롤러 "자동 근태처리" 스케줄과 무관하게 스테이징을 자주 비우는 용도 — 준실시간 원하면 rate 를 줄인다.
# file 모드(사내 UNC 공유 txt)는 Fargate 에서 공유폴더 접근 불가 → 사내 러너에서 별도로 실행할 것(adt-ingest.ts 주석 참조).

resource "aws_cloudwatch_event_rule" "adt_ingest" {
  name                = "${local.name}-adt-ingest"
  description         = "ADT 근태 스테이징 정규화·초과근무 산정(DB 모드)"
  schedule_expression = "rate(30 minutes)"
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
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.ecs_task.arn, aws_iam_role.ecs_task_execution.arn]
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "adt_ingest" {
  rule     = aws_cloudwatch_event_rule.adt_ingest.name
  arn      = aws_ecs_cluster.main.arn
  role_arn = aws_iam_role.adt_ingest_events.arn

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

  # next 컨테이너 커맨드를 배치 엔트리로 오버라이드 + DB 모드 env 주입.
  input = jsonencode({
    containerOverrides = [{
      name        = "next"
      command     = ["node", ".next/adt-ingest.cjs"]
      environment = [{ name = "ADT_INGEST_MODE", value = "db" }]
    }]
  })
}
