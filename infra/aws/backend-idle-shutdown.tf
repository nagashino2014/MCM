# 유휴 OCR backend 자동 셧다운.
# EventBridge 스케줄(10분) → Lambda 가 CPU 유휴를 판정해 backend ECS 서비스를 desired_count=0 으로 내린다.
# backend 는 평소 0(ignore_changes)로 두고 OCR 시 수동 기동(start-staging.ps1 -Backend)하는 운영을 보완:
# 켜두고 깜빡해도 유휴 60분 뒤 자동으로 내려가 24/7 과금을 방지한다.

data "archive_file" "backend_idle_shutdown" {
  type        = "zip"
  source_file = "${path.module}/lambda/backend_idle_shutdown.py"
  output_path = "${path.module}/lambda/backend_idle_shutdown.zip"
}

resource "aws_iam_role" "backend_idle_shutdown" {
  name = "${local.name}-backend-idle-shutdown"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "backend_idle_shutdown" {
  name = "${local.name}-backend-idle-shutdown"
  role = aws_iam_role.backend_idle_shutdown.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:UpdateService"]
        Resource = "*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricStatistics"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "backend_idle_shutdown" {
  name              = "/aws/lambda/${local.name}-backend-idle-shutdown"
  retention_in_days = 14
  tags              = local.tags
}

resource "aws_lambda_function" "backend_idle_shutdown" {
  function_name    = "${local.name}-backend-idle-shutdown"
  role             = aws_iam_role.backend_idle_shutdown.arn
  runtime          = "python3.12"
  handler          = "backend_idle_shutdown.handler"
  filename         = data.archive_file.backend_idle_shutdown.output_path
  source_code_hash = data.archive_file.backend_idle_shutdown.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      CLUSTER       = aws_ecs_cluster.main.name
      SERVICE       = aws_ecs_service.backend.name
      IDLE_MINUTES  = "60"
      CPU_THRESHOLD = "3.0"
    }
  }

  depends_on = [aws_cloudwatch_log_group.backend_idle_shutdown]
  tags       = local.tags
}

resource "aws_cloudwatch_event_rule" "backend_idle_shutdown" {
  name                = "${local.name}-backend-idle-shutdown"
  description         = "10분마다 유휴 OCR backend 자동 셧다운 검사"
  schedule_expression = "rate(10 minutes)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "backend_idle_shutdown" {
  rule      = aws_cloudwatch_event_rule.backend_idle_shutdown.name
  target_id = "lambda"
  arn       = aws_lambda_function.backend_idle_shutdown.arn
}

resource "aws_lambda_permission" "backend_idle_shutdown" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend_idle_shutdown.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.backend_idle_shutdown.arn
}
