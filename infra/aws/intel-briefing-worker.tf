# 정기 브리핑 전용 family만 기동한다. 기존 ADT/intel EventBridge target·고정 revision은 변경하지 않는다.
# 전체 apply 금지. 이 리소스만 포함한 plan을 검토한 뒤 승인된 target으로 적용한다.
resource "aws_iam_role_policy" "intel_briefing_worker_start" {
  name = "${local.name}-intel-briefing-worker-start"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = ["arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name}-intel-briefing:*"]
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = [aws_iam_role.ecs_task.arn, aws_iam_role.ecs_task_execution_next.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      }
    ]
  })
}
