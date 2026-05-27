output "gcs_bucket_name" {
  description = "Canonical image originals bucket name."
  value       = google_storage_bucket.image_originals.name
}

output "runtime_service_account_email" {
  description = "Service account email to use for the Upload Function runtime."
  value       = google_service_account.upload_function.email
}

output "r2_access_key_id_secret_name" {
  description = "Secret Manager resource name for R2_ACCESS_KEY_ID."
  value       = google_secret_manager_secret.r2[var.r2_access_key_id_secret_id].name
}

output "r2_secret_access_key_secret_name" {
  description = "Secret Manager resource name for R2_SECRET_ACCESS_KEY."
  value       = google_secret_manager_secret.r2[var.r2_secret_access_key_secret_id].name
}

output "s3_source_access_key_id_secret_name" {
  description = "Secret Manager resource name for S3_SOURCE_ACCESS_KEY_ID."
  value       = google_secret_manager_secret.s3_source[var.s3_source_access_key_id_secret_id].name
}

output "s3_source_secret_access_key_secret_name" {
  description = "Secret Manager resource name for S3_SOURCE_SECRET_ACCESS_KEY."
  value       = google_secret_manager_secret.s3_source[var.s3_source_secret_access_key_secret_id].name
}

output "redis_url_secret_name" {
  description = "Secret Manager resource name for REDIS_URL."
  value       = google_secret_manager_secret.redis[var.redis_url_secret_id].name
}

output "upload_function_environment" {
  description = "Non-secret environment variables for the Upload Function runtime."
  value = {
    GCS_BUCKET                = google_storage_bucket.image_originals.name
    PUBLIC_BASE_URL           = var.public_base_url
    SIGNED_URL_TTL_SECONDS    = tostring(var.signed_url_ttl_seconds)
    CORS_ALLOW_ORIGIN         = var.cors_allow_origin
    R2_ACCOUNT_ID             = var.r2_account_id
    R2_BUCKET                 = var.r2_bucket
    R2_REPLICATION_RETRIES    = tostring(var.r2_replication_retries)
    S3_SOURCE_ENDPOINT        = var.s3_source_endpoint
    S3_SOURCE_REGION          = var.s3_source_region
    S3_SOURCE_ALLOWED_BUCKETS = join(",", var.s3_source_allowed_buckets)
    SESSION_STORE             = "redis"
    REDIS_KEY_PREFIX          = var.redis_key_prefix
  }
}

output "secret_version_commands" {
  description = "Commands to add secret values after terraform apply. Do not put secret values in Terraform variables or state."
  value = {
    R2_ACCESS_KEY_ID            = "printf %s '<r2-access-key-id>' | gcloud secrets versions add ${var.r2_access_key_id_secret_id} --project=${var.project_id} --data-file=-"
    R2_SECRET_ACCESS_KEY        = "printf %s '<r2-secret-access-key>' | gcloud secrets versions add ${var.r2_secret_access_key_secret_id} --project=${var.project_id} --data-file=-"
    S3_SOURCE_ACCESS_KEY_ID     = "printf %s '<s3-source-access-key-id>' | gcloud secrets versions add ${var.s3_source_access_key_id_secret_id} --project=${var.project_id} --data-file=-"
    S3_SOURCE_SECRET_ACCESS_KEY = "printf %s '<s3-source-secret-access-key>' | gcloud secrets versions add ${var.s3_source_secret_access_key_secret_id} --project=${var.project_id} --data-file=-"
    REDIS_URL                   = "printf %s '<redis-url>' | gcloud secrets versions add ${var.redis_url_secret_id} --project=${var.project_id} --data-file=-"
  }
}
