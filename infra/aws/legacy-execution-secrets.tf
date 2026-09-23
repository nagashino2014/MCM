# revision 618과 기존 worker를 다시 시작할 수 있는 전환 창 동안 정책을 보존한다.
# count 추가 시 기존 Terraform state 주소가 삭제되지 않도록 명시적으로 이동한다.
moved {
  from = aws_iam_role_policy.ecs_task_execution_secrets
  to   = aws_iam_role_policy.ecs_task_execution_secrets[0]
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  count = var.r0b_transition_allow_legacy_roles ? 1 : 0

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
