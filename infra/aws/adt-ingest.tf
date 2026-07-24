# ADT 근태 인제스트 배치 (file 모드 · S3 경유).
# 사내 컨트롤러 PC 가 "근태결과 파일생성"의 txt(ovrwrk_YYYYMMDD.txt)를 `aws s3 sync` 로 전용 버킷 incoming/ 에 업로드
#   → EventBridge(주기) → ECS RunTask(next 이미지, .next/adt-ingest.cjs, ADT_INGEST_MODE=file)가 S3 에서 읽어 정규화·산정.
# 사내→AWS 는 아웃바운드 HTTPS(S3) 만 — Aurora(private) 직접 접속 불필요.
# next task def env(PG*·AWS_REGION)를 상속. 파일 수가 커지면 후속에서 증분/archive 최적화.

# ── 전용 버킷(사내 업로드 대상) ──────────────────────────────────────────
resource "aws_s3_bucket" "adt_attendance" {
  bucket = "${local.name}-adt-attendance"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "adt_attendance" {
  bucket                  = aws_s3_bucket.adt_attendance.id
  block_public_acls       = true
  block_public_policy      = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "adt_attendance" {
  bucket = aws_s3_bucket.adt_attendance.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── 배치(ECS task role)에 버킷 읽기 권한 ─────────────────────────────────
resource "aws_iam_role_policy" "adt_ingest_s3_read" {
  name = "${local.name}-adt-ingest-s3-read"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.adt_attendance.arn]
        Condition = { StringLike = { "s3:prefix" = ["incoming/*"] } }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.adt_attendance.arn}/incoming/*"]
      }
    ]
  })
}

# ── 사내 업로드 전용 IAM 사용자(쓰기 전용) ───────────────────────────────
# 액세스키는 tfstate 노출을 피하려 콘솔/CLI 로 수동 발급해 사내 PC 에 배치할 것(aws_iam_access_key 미생성).
resource "aws_iam_user" "adt_uploader" {
  name = "${local.name}-adt-uploader"
  tags = local.tags
}

resource "aws_iam_user_policy" "adt_uploader" {
  name = "${local.name}-adt-uploader"
  user = aws_iam_user.adt_uploader.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.adt_attendance.arn]
        Condition = { StringLike = { "s3:prefix" = ["incoming/*"] } }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.adt_attendance.arn}/incoming/*"]
      }
    ]
  })
}

# ── 스케줄 → ECS RunTask ─────────────────────────────────────────────────
resource "aws_cloudwatch_event_rule" "adt_ingest" {
  name                = "${local.name}-adt-ingest"
  description         = "ADT 근태 S3 취식·정규화·초과근무 산정(file 모드)"
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

  # next 컨테이너 커맨드를 배치 엔트리로 오버라이드 + file(S3) 모드 env 주입.
  input = jsonencode({
    containerOverrides = [{
      name    = "next"
      command = ["node", ".next/adt-ingest.cjs"]
      environment = [
        { name = "ADT_INGEST_MODE", value = "file" },
        { name = "ADT_FILE_S3_BUCKET", value = aws_s3_bucket.adt_attendance.bucket },
        { name = "ADT_FILE_S3_PREFIX", value = "incoming/" },
      ]
    }]
  })
}
