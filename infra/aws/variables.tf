variable "project_name" {
  type    = string
  default = "mcm-ieps"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["ap-northeast-2a", "ap-northeast-2c"]
}

variable "db_username" {
  type    = string
  default = "mcm"
}

variable "db_name" {
  type    = string
  default = "mcm"
}

variable "container_image_next" {
  type    = string
  default = "public.ecr.aws/docker/library/node:20-alpine"
}

variable "container_image_backend" {
  type    = string
  default = "public.ecr.aws/docker/library/python:3.11-slim"
}

variable "container_image_worker" {
  type    = string
  default = "public.ecr.aws/docker/library/node:20-bookworm"
}
