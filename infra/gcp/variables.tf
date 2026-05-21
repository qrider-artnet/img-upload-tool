variable "project_id" {
  description = "GCP project ID that owns the upload infrastructure."
  type        = string
}

variable "region" {
  description = "Default GCP region for regional resources."
  type        = string
  default     = "us-east4"
}

variable "enable_project_services" {
  description = "Whether Terraform should enable the Google APIs required by the current upload-function infrastructure."
  type        = bool
  default     = true
}

variable "bucket_name" {
  description = "Globally unique GCS bucket name for canonical image originals."
  type        = string
}

variable "bucket_location" {
  description = "GCS bucket location. Use US-EAST4 for a regional bucket near the Cloud Run Function region."
  type        = string
  default     = "US-EAST4"
}

variable "bucket_storage_class" {
  description = "Storage class for canonical image originals."
  type        = string
  default     = "STANDARD"
}

variable "bucket_force_destroy" {
  description = "Whether Terraform may delete the bucket while it still contains objects. Keep false outside throwaway dev projects."
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "Origins allowed to PUT directly to the signed GCS upload URL."
  type        = list(string)
  default     = ["*"]
}

variable "tombstone_retention_days" {
  description = "Number of days to retain tombstones under tombstones/ before GCS lifecycle deletion."
  type        = number
  default     = 7
}

variable "staging_upload_retention_days" {
  description = "Number of days to retain abandoned direct-upload objects under staging/uploads/ before GCS lifecycle deletion."
  type        = number
  default     = 5
}

variable "runtime_service_account_id" {
  description = "Service account ID used by the Upload Function runtime."
  type        = string
  default     = "artnet-upload-function"
}

variable "runtime_service_account_display_name" {
  description = "Human-readable display name for the Upload Function runtime service account."
  type        = string
  default     = "Artnet Upload Function runtime"
}

variable "public_base_url" {
  description = "Public image base URL returned by finalize responses."
  type        = string
  default     = "https://artworks.artnet.com"
}

variable "signed_url_ttl_seconds" {
  description = "Signed GCS upload URL TTL in seconds."
  type        = number
  default     = 900
}

variable "cors_allow_origin" {
  description = "CORS allow-origin value used by the Upload Function HTTP responses."
  type        = string
  default     = "*"
}

variable "r2_account_id" {
  description = "Cloudflare account ID used to build the R2 S3-compatible endpoint."
  type        = string
}

variable "r2_bucket" {
  description = "Cloudflare R2 bucket name used as the replication mirror."
  type        = string
}

variable "r2_replication_retries" {
  description = "Additional R2 PUT/DELETE retry attempts after the first try."
  type        = number
  default     = 3
}

variable "r2_access_key_id_secret_id" {
  description = "Secret Manager secret ID that will hold R2_ACCESS_KEY_ID."
  type        = string
  default     = "r2-access-key-id"
}

variable "r2_secret_access_key_secret_id" {
  description = "Secret Manager secret ID that will hold R2_SECRET_ACCESS_KEY."
  type        = string
  default     = "r2-secret-access-key"
}

variable "s3_source_endpoint" {
  description = "S3-compatible source endpoint used by POST /v1/ingest/from-s3."
  type        = string
}

variable "s3_source_region" {
  description = "Region for the S3-compatible source. Use auto for R2."
  type        = string
  default     = "auto"
}

variable "s3_source_allowed_buckets" {
  description = "S3 source bucket names accepted by the ingest endpoint."
  type        = list(string)
}

variable "s3_source_access_key_id_secret_id" {
  description = "Secret Manager secret ID that will hold S3_SOURCE_ACCESS_KEY_ID."
  type        = string
  default     = "s3-source-access-key-id"
}

variable "s3_source_secret_access_key_secret_id" {
  description = "Secret Manager secret ID that will hold S3_SOURCE_SECRET_ACCESS_KEY."
  type        = string
  default     = "s3-source-secret-access-key"
}

variable "redis_url_secret_id" {
  description = "Secret Manager secret ID that will hold REDIS_URL."
  type        = string
  default     = "redis-url"
}

variable "redis_key_prefix" {
  description = "Redis key prefix for upload sessions."
  type        = string
  default     = "upload-session:"
}

variable "labels" {
  description = "Labels applied to supported resources."
  type        = map(string)
  default = {
    app        = "artnet-image-upload"
    managed_by = "terraform"
  }
}
