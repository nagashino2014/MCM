data "aws_iam_policy_document" "sfn_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "secret_rotation_redeploy_sfn" {
  name               = "${local.name}-secret-rotation-redeploy-sfn"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy" "secret_rotation_redeploy_sfn" {
  name = "${local.name}-secret-rotation-redeploy-sfn"
  role = aws_iam_role.secret_rotation_redeploy_sfn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ]
      Resource = aws_ecs_service.next.id
    }]
  })
}

resource "aws_sfn_state_machine" "secret_rotation_redeploy_next" {
  name     = "${local.name}-secret-rotation-redeploy-next"
  role_arn = aws_iam_role.secret_rotation_redeploy_sfn.arn

  definition = jsonencode({
    StartAt = "ForceNewDeployment"
    States = {
      ForceNewDeployment = {
        Type     = "Task"
        Resource = "arn:aws:states:::aws-sdk:ecs:updateService"
        Parameters = {
          Cluster            = aws_ecs_cluster.main.arn
          Service            = aws_ecs_service.next.name
          ForceNewDeployment = true
        }
        End = true
      }
    }
  })

  tags = local.tags
}

resource "aws_cloudwatch_event_rule" "rds_master_credentials_reset" {
  name        = "${local.name}-rds-master-credentials-reset"
  description = "Force a new Next.js ECS deployment when RDS rotates the managed master password."

  event_pattern = jsonencode({
    source      = ["aws.rds"]
    detail-type = ["RDS DB Cluster Event"]
    resources   = [aws_rds_cluster.main.arn]
    detail = {
      Message = ["Reset master credentials"]
    }
  })

  tags = local.tags
}

data "aws_iam_policy_document" "events_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "secret_rotation_redeploy_events" {
  name               = "${local.name}-secret-rotation-redeploy-events"
  assume_role_policy = data.aws_iam_policy_document.events_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy" "secret_rotation_redeploy_events" {
  name = "${local.name}-secret-rotation-redeploy-events"
  role = aws_iam_role.secret_rotation_redeploy_events.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "states:StartExecution"
      Resource = aws_sfn_state_machine.secret_rotation_redeploy_next.arn
    }]
  })
}

resource "aws_cloudwatch_event_target" "rds_master_credentials_reset" {
  rule     = aws_cloudwatch_event_rule.rds_master_credentials_reset.name
  arn      = aws_sfn_state_machine.secret_rotation_redeploy_next.arn
  role_arn = aws_iam_role.secret_rotation_redeploy_events.arn
}
