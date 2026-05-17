output "r2_bucket_name" {
  description = "R2 bucket name used by the Upload Function replication target."
  value       = cloudflare_r2_bucket.replication.name
}

output "r2_bucket_jurisdiction" {
  description = "R2 bucket jurisdiction."
  value       = cloudflare_r2_bucket.replication.jurisdiction
}

output "r2_endpoint" {
  description = "S3-compatible endpoint used by the Upload Function R2 client."
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
}

output "artwork_hostname" {
  description = "Artwork serving hostname."
  value       = var.artwork_hostname
}

output "worker_custom_domain_id" {
  description = "Worker custom domain ID, when enabled."
  value       = try(cloudflare_workers_custom_domain.artwork[0].id, null)
}

output "gcp_r2_environment" {
  description = "Values that should match the GCP Terraform/upload-function configuration."
  value = {
    R2_ACCOUNT_ID   = var.account_id
    R2_BUCKET       = cloudflare_r2_bucket.replication.name
    PUBLIC_BASE_URL = "https://${var.artwork_hostname}"
  }
}
