variable "cloudflare_api_token" {
  description = "Cloudflare API token used by Terraform. Prefer setting TF_VAR_cloudflare_api_token from a secret store."
  type        = string
  sensitive   = true
  default     = null
}

variable "account_id" {
  description = "Cloudflare account ID that owns the R2 bucket and Worker."
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID for the domain that will host the artwork Worker custom domain."
  type        = string
}

variable "zone_name" {
  description = "Cloudflare zone name, for example artnet-dev.com."
  type        = string
}

variable "environment" {
  description = "Environment name used for labels and generated names."
  type        = string
}

variable "r2_bucket_name" {
  description = "R2 bucket name used as the GCS replication mirror."
  type        = string
}

variable "r2_location" {
  description = "Optional R2 location hint. Cloudflare treats this as best effort and only honors it on first create."
  type        = string
  default     = "enam"
}

variable "r2_storage_class" {
  description = "Default R2 storage class for newly uploaded objects."
  type        = string
  default     = "Standard"
}

variable "r2_jurisdiction" {
  description = "R2 jurisdiction. Use default unless legal/data-residency requirements say otherwise."
  type        = string
  default     = "default"
}

variable "enable_worker_custom_domain" {
  description = "Create a Worker custom domain for the artwork serving hostname. Requires worker_service_name to already exist."
  type        = bool
  default     = false
}

variable "artwork_hostname" {
  description = "Public artwork hostname served by the Variant Worker."
  type        = string
}

variable "worker_service_name" {
  description = "Cloudflare Worker service/script name that will serve artwork requests. Required when enable_worker_custom_domain is true."
  type        = string
  default     = null

  validation {
    condition     = var.enable_worker_custom_domain == false || var.worker_service_name != null
    error_message = "worker_service_name is required when enable_worker_custom_domain is true."
  }
}
