data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.name}-ecs-execution-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "app_access" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.app_data.arn,
      "${aws_s3_bucket.app_data.arn}/*"
    ]
  }

  statement {
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes"
    ]
    resources = [aws_sqs_queue.jobs.arn, aws_sqs_queue.jobs_dlq.arn]
  }

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "app_access" {
  name   = "${local.name}-app-access"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.app_access.json
}

resource "aws_ecs_task_definition" "next" {
  family                   = "${local.name}-next"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "next"
      image     = var.container_image_next
      essential = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket },
        { name = "MCM_JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
        { name = "MCM_JOB_QUEUE_MODE", value = "sqs" }
      ]
      secrets = [
        { name = "DATABASE_URL",   valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
        { name = "AUTH_SECRET",    valueFrom = "${aws_secretsmanager_secret.app.arn}:AUTH_SECRET::" },
        { name = "ADMIN_USERNAME", valueFrom = "${aws_secretsmanager_secret.app.arn}:ADMIN_USERNAME::" },
        { name = "ADMIN_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app.arn}:ADMIN_PASSWORD::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.next.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "next"
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 4096
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.container_image_backend
      essential = true
      portMappings = [{ containerPort = 8001, protocol = "tcp" }]
      environment = [
        { name = "DOCKER_ENV", value = "true" },
        { name = "OCR_USE_GPU", value = "false" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "backend"
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 3072
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = var.container_image_worker
      essential = true
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "MCM_STORAGE_BUCKET", value = aws_s3_bucket.app_data.bucket },
        { name = "MCM_JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
        { name = "IEPS_BACKEND_URL", value = "http://backend.local:8001" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_ecs_service" "next" {
  name            = "${local.name}-next"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.next.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    assign_public_ip = false
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.next.arn
    container_name   = "next"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
  tags       = local.tags
}
