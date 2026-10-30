resource "aws_ecr_repository" "next" {
  name                 = "${local.name}-next"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_ecr_repository" "backend" {
  name                 = "${local.name}-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_ecr_repository" "worker" {
  name                 = "${local.name}-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "keep_last_10" {
  for_each = {
    next      = aws_ecr_repository.next.name
    backend   = aws_ecr_repository.backend.name
    worker    = aws_ecr_repository.worker.name
    converter = aws_ecr_repository.converter.name
  }

  repository = each.value

  # next 는 ADT·intel 스케줄이 숫자 revision 에 고정돼 있어, 그 이미지가 개수 규칙으로 만료되면
  # 배치가 CannotPullContainerError 로 조용히 멈춘다(2026-10-01 627 이미지 만료 → 한 달 수집 중단).
  # 고정 revision 이미지는 schedule-pin-* 태그(이미지 묶음·하위 매니페스트 모두)를 붙여 1순위 규칙으로
  # 보호한다 — 상위 규칙에 걸린 이미지는 하위 규칙(any)이 만료시키지 않는다. 태그는
  # ops/staging-protect-pinned-image.ps1 로 붙인다. 개수도 10(푸시당 항목 3개라 배포 약 3회분)→30.
  policy = each.key == "next" ? jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Protect schedule-pinned images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["schedule-pin-*"]
          countType      = "imageCountMoreThan"
          countNumber    = 30
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 30 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      }
    ]
    }) : jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
