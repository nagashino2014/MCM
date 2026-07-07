data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_iam_role" "bastion" {
  name = "${local.name}-bastion"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${local.name}-bastion"
  role = aws_iam_role.bastion.name
}

resource "aws_security_group" "bastion" {
  name        = "${local.name}-bastion"
  # description 변경은 SG 재생성(forces replacement)을 유발하므로 원문 유지.
  description = "Bastion host for SSM port forwarding"
  vpc_id      = aws_vpc.main.id

  # ECS(next) 태스크 -> bastion tinyproxy(8888). DART 고정 IP 아웃바운드용.
  # SG 참조로만 허용(VPC 내부), 외부 노출 없음.
  ingress {
    from_port       = 8888
    to_port         = 8888
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
    description     = "tinyproxy from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_instance" "bastion" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  # NAT 제거에 따라 public subnet 배치 + public IP 로 SSM 아웃바운드 확보.
  # bastion SG 는 인바운드 규칙이 없어(egress only) public IP 가 붙어도 외부 접근 불가.
  subnet_id                   = aws_subnet.public[0].id
  associate_public_ip_address = true
  # DART 프록시 타깃(ECS -> bastion:8888)이 재생성돼도 불변이도록 private IP 고정.
  # 현재 실행 중인 인스턴스의 실제 값과 동일 → 재생성 없이 no-op.
  private_ip                  = "10.40.0.226"
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name

  user_data = <<-EOF
    #!/bin/bash
    set -eux
    dnf -y update || true
    dnf -y install amazon-ssm-agent || true
    systemctl enable amazon-ssm-agent
    systemctl restart amazon-ssm-agent
  EOF

  user_data_replace_on_change = true

  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = merge(local.tags, { Name = "${local.name}-bastion" })

  # al2023 데이터소스(most_recent=true)가 시간이 지나며 새 AMI 로 바뀌어도
  # 매 apply 마다 bastion 을 재생성하지 않도록 AMI 변경 무시(현재 인스턴스 유지).
  lifecycle {
    ignore_changes = [ami]
  }
}

# DART OpenAPI 는 인증키에 등록된 IP 에서만 호출을 허용한다(status 012).
# NAT 제거로 ECS 아웃바운드 IP 가 태스크마다 바뀌므로, bastion 에 EIP 를 고정해
# 고정 아웃바운드 IP 를 확보하고 bastion 의 tinyproxy 경유로 DART 를 호출한다.
resource "aws_eip" "bastion" {
  domain   = "vpc"
  instance = aws_instance.bastion.id
  tags     = merge(local.tags, { Name = "${local.name}-bastion" })

  depends_on = [aws_internet_gateway.main]
}
