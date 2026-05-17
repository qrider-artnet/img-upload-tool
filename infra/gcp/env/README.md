# GCP Environments

Environment-specific Terraform variable files live here.

## Dev: artnet-dev.com

Create a local, uncommitted dev variable file:

```bash
cp infra/gcp/env/dev.tfvars.example infra/gcp/env/dev.tfvars
```

Edit these values in `env/dev.tfvars`:

- `project_id` if the GCP project is not literally `artnet-dev`
- `bucket_name` if the default global GCS bucket name is unavailable
- `r2_account_id`
- `r2_bucket` if the lower-environment R2 bucket uses a different name

Then run:

```bash
terraform -chdir=infra/gcp init
terraform -chdir=infra/gcp plan -var-file=env/dev.tfvars
terraform -chdir=infra/gcp apply -var-file=env/dev.tfvars
```

After apply, add the R2 secret values to the dev secrets:

```bash
printf %s '<dev-r2-access-key-id>' \
  | gcloud secrets versions add artnet-dev-r2-access-key-id \
      --project='<dev-gcp-project-id>' \
      --data-file=-

printf %s '<dev-r2-secret-access-key>' \
  | gcloud secrets versions add artnet-dev-r2-secret-access-key \
      --project='<dev-gcp-project-id>' \
      --data-file=-
```

Do not put R2 secret values in Terraform variables. Terraform state stores variable values.
