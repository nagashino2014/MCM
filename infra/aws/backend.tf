terraform {
  backend "s3" {
    bucket              = "mcm-ieps-staging-tfstate-195748745315-apne2"
    key                 = "mcm-ieps/staging/terraform.tfstate"
    region              = "ap-northeast-2"
    dynamodb_table      = "mcm-ieps-staging-terraform-lock"
    encrypt             = true
    allowed_account_ids = ["195748745315"]
  }
}
