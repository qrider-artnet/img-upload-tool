# Cloudflare Environments

Environment-specific Cloudflare Terraform variable files live here.

## Dev: artnet-dev.com

Create a local, uncommitted dev variable file:

```bash
cp infra/cloudflare/env/dev.tfvars.example infra/cloudflare/env/dev.tfvars
```

Edit these values:

- `account_id`
- `zone_id`
- `r2_bucket_name` if the lower-environment bucket needs a different name
- `worker_service_name` when the Variant Worker is implemented

Authenticate Terraform with a Cloudflare API token:

```bash
export TF_VAR_cloudflare_api_token='<cloudflare-api-token>'
```

The token needs permissions for:

- Account → R2 Storage → Edit
- Account → Workers Scripts → Edit, only when `enable_worker_custom_domain = true`
- Zone → Workers Routes → Edit, only when `enable_worker_custom_domain = true`
- Zone → Zone → Read

Then run:

```bash
terraform -chdir=infra/cloudflare init
terraform -chdir=infra/cloudflare plan -var-file=env/dev.tfvars
terraform -chdir=infra/cloudflare apply -var-file=env/dev.tfvars
```

## R2 Access Keys

This Terraform creates the R2 bucket, but it does not create R2 S3 access keys.
Generate a scoped R2 access key in the Cloudflare dashboard and write the values
to the GCP Secret Manager secrets created by `infra/gcp`.

For dev, the GCP secret IDs are:

- `artnet-dev-r2-access-key-id`
- `artnet-dev-r2-secret-access-key`

Do not put the R2 S3 secret access key in Terraform variables. Terraform state
stores variable values.
