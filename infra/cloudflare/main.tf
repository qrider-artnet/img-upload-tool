resource "cloudflare_r2_bucket" "replication" {
  account_id    = var.account_id
  name          = var.r2_bucket_name
  jurisdiction  = var.r2_jurisdiction
  location      = var.r2_location
  storage_class = var.r2_storage_class
}

resource "cloudflare_workers_custom_domain" "artwork" {
  count = var.enable_worker_custom_domain ? 1 : 0

  account_id = var.account_id
  hostname   = var.artwork_hostname
  service    = var.worker_service_name
  zone_id    = var.zone_id
  zone_name  = var.zone_name
}
