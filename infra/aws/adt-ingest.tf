# ADT 근태 인제스트 배치 (웹 업로드 방식의 보조 배치).
# 근태 데이터의 주 수집 경로는 관리자 웹 업로드(/approval/attendance → /api/approval/attendance/upload)로,
# 엑셀 업로드 시 즉시 파싱·산정된다. 이 스케줄은 "직원 매핑 후 미처리 스테이징(processed=false) 재정규화"만 담당한다.
# (사내→클라우드 S3 sync 경로는 웹 업로드 채택으로 폐기 — 관련 버킷/업로드 IAM 은 이 파일에서 제거됨.)
# next task def env(PG*)를 상속. mode=db(스테이징 재처리).

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

  # next 컨테이너 커맨드를 배치 엔트리로 오버라이드 — db 모드(미처리 스테이징 재정규화).
  input = jsonencode({
    containerOverrides = [{
      name        = "next"
      command     = ["node", ".next/adt-ingest.cjs"]
      environment = [{ name = "ADT_INGEST_MODE", value = "db" }]
    }]
  })
}
