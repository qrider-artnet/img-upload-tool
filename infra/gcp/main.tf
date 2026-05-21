locals {
  required_services = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
  ])

  r2_secret_ids = toset([
    var.r2_access_key_id_secret_id,
    var.r2_secret_access_key_secret_id,
  ])

  s3_source_secret_ids = toset([
    var.s3_source_access_key_id_secret_id,
    var.s3_source_secret_access_key_secret_id,
  ])

  redis_secret_ids = toset([
    var.redis_url_secret_id,
  ])
}

resource "google_project_service" "required" {
  for_each = var.enable_project_services ? local.required_services : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "upload_function" {
  project      = var.project_id
  account_id   = var.runtime_service_account_id
  display_name = var.runtime_service_account_display_name
}

resource "google_storage_bucket" "image_originals" {
  project  = var.project_id
  name     = var.bucket_name
  location = var.bucket_location

  force_destroy               = var.bucket_force_destroy
  public_access_prevention    = "enforced"
  storage_class               = var.bucket_storage_class
  uniform_bucket_level_access = true

  labels = var.labels

  cors {
    origin          = var.cors_allowed_origins
    method          = ["PUT"]
    response_header = ["Content-Type", "X-Goog-Content-Length-Range"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = var.tombstone_retention_days
      matches_prefix = ["tombstones/"]
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = var.staging_upload_retention_days
      matches_prefix = ["staging/uploads/"]
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "upload_function_object_admin" {
  bucket = google_storage_bucket.image_originals.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.upload_function.member
}

resource "google_storage_bucket_iam_member" "upload_function_bucket_reader" {
  bucket = google_storage_bucket.image_originals.name
  role   = "roles/storage.legacyBucketReader"
  member = google_service_account.upload_function.member
}

resource "google_service_account_iam_member" "upload_function_can_sign_urls" {
  service_account_id = google_service_account.upload_function.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.upload_function.member
}

resource "google_secret_manager_secret" "r2" {
  for_each = local.r2_secret_ids

  project   = var.project_id
  secret_id = each.value
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "s3_source" {
  for_each = local.s3_source_secret_ids

  project   = var.project_id
  secret_id = each.value
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "redis" {
  for_each = local.redis_secret_ids

  project   = var.project_id
  secret_id = each.value
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "upload_function_r2_secret_accessor" {
  for_each = google_secret_manager_secret.r2

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.upload_function.member
}

resource "google_secret_manager_secret_iam_member" "upload_function_s3_source_secret_accessor" {
  for_each = google_secret_manager_secret.s3_source

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.upload_function.member
}

resource "google_secret_manager_secret_iam_member" "upload_function_redis_secret_accessor" {
  for_each = google_secret_manager_secret.redis

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.upload_function.member
}
