output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "app_url" {
  value = "https://${var.domain_name}"
}

output "s3_bucket" {
  value = aws_s3_bucket.app_data.bucket
}

output "job_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "aurora_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "secret_name" {
  value = aws_secretsmanager_secret.app.name
}

output "bastion_instance_id" {
  value = aws_instance.bastion.id
}

output "ecr_next_url" {
  value = aws_ecr_repository.next.repository_url
}

output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_worker_url" {
  value = aws_ecr_repository.worker.repository_url
}
