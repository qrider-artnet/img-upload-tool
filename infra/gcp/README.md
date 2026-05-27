# GCP Terraform

Terraform for the GCP resources required by the current Upload Function implementation.

This root creates:

- a private GCS bucket for canonical image originals
- CORS on that bucket for browser direct uploads to signed URLs
- a lifecycle rule that deletes `tombstones/` markers after 7 days
- a lifecycle rule that deletes abandoned `staging/uploads/` direct-upload objects after 5 days
- an Upload Function runtime service account
- bucket IAM for object read/write/delete and bucket health checks
- self `iam.serviceAccountTokenCreator` on the runtime service account so it can create V4 GCS signed URLs without a downloaded key
- Secret Manager secrets for the R2, S3 source, and Redis URL values
- Secret Manager IAM allowing the runtime service account to read those secrets

It intentionally does not create:

- the Cloudflare R2 bucket or R2 API token
- secret versions containing real R2, S3 source, or Redis credentials/URLs
- the Cloud Run Function itself
- a VPC connector
- Cloud Armor rate limiting

Those are separate decisions or external-provider resources. The spec marks VPC attachment as TBD, so this Terraform does not choose one.

## Use

```bash
cd infra/gcp
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`, then run:

```bash
terraform init
terraform plan
terraform apply
```

For the `artnet-dev.com` lower environment, use the dev variable file instead:

```bash
cp env/dev.tfvars.example env/dev.tfvars
terraform plan -var-file=env/dev.tfvars
terraform apply -var-file=env/dev.tfvars
```

After `terraform apply`, add the R2, S3 source, and Redis URL values to Secret Manager. Do not put secret values in `terraform.tfvars`; Terraform state would retain them.

```bash
printf %s '<r2-access-key-id>' \
  | gcloud secrets versions add r2-access-key-id \
      --project='<your-gcp-project-id>' \
      --data-file=-

printf %s '<r2-secret-access-key>' \
  | gcloud secrets versions add r2-secret-access-key \
      --project='<your-gcp-project-id>' \
      --data-file=-

printf %s '<s3-source-access-key-id>' \
  | gcloud secrets versions add s3-source-access-key-id \
      --project='<your-gcp-project-id>' \
      --data-file=-

printf %s '<s3-source-secret-access-key>' \
  | gcloud secrets versions add s3-source-secret-access-key \
      --project='<your-gcp-project-id>' \
      --data-file=-

printf %s '<redis-url>' \
  | gcloud secrets versions add redis-url \
      --project='<your-gcp-project-id>' \
      --data-file=-
```

## Upload Function Environment

`terraform output upload_function_environment` prints the non-secret runtime environment:

```text
GCS_BUCKET
PUBLIC_BASE_URL
SIGNED_URL_TTL_SECONDS
CORS_ALLOW_ORIGIN
R2_ACCOUNT_ID
R2_BUCKET
R2_REPLICATION_RETRIES
S3_SOURCE_ENDPOINT
S3_SOURCE_REGION
S3_SOURCE_ALLOWED_BUCKETS
SESSION_STORE
REDIS_KEY_PREFIX
```

When deploying the function, wire `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `S3_SOURCE_ACCESS_KEY_ID`, `S3_SOURCE_SECRET_ACCESS_KEY`, and `REDIS_URL` from the Secret Manager secrets created by this root.

The runtime service account output should be used as the function service account.
