# Cloudflare Terraform

Terraform for the Cloudflare resources needed by the image upload project.

This root creates:

- the R2 bucket that mirrors GCS originals
- optionally, a Worker custom domain for the artwork serving hostname

It intentionally does not create:

- R2 S3 access keys, because those are secrets and should not enter Terraform state
- the Variant Worker script itself; deploy `variant-worker/` with Wrangler so its R2 and Images bindings stay with the component
- direct public R2 custom domains, because the intended architecture serves images through the Variant Worker

## Use

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`, then authenticate Terraform:

```bash
export TF_VAR_cloudflare_api_token='<cloudflare-api-token>'
```

Run:

```bash
terraform init
terraform plan
terraform apply
```

For `artnet-dev.com`, use the dev variable file:

```bash
cp env/dev.tfvars.example env/dev.tfvars
terraform plan -var-file=env/dev.tfvars
terraform apply -var-file=env/dev.tfvars
```

## Dev: artworks.artnet-dev.com

The dev file sets:

- R2 bucket: `artnet-dev-image-upload-originals`
- artwork hostname: `artworks.artnet-dev.com`
- Worker custom domain disabled by default

Deploy the Worker first:

```bash
cd variant-worker
npm install
npm run deploy
```

Then set:

```hcl
enable_worker_custom_domain = true
worker_service_name         = "artnet-variant-worker-dev"
```

Do not create a normal DNS `CNAME` for `artworks.artnet-dev.com` if you plan to
use a Worker custom domain. Cloudflare Worker custom domains own that hostname.

## R2 Access Keys

After the R2 bucket exists, create an R2 S3 access key in Cloudflare:

- scope: Object Read & Write
- bucket: the environment bucket, for dev `artnet-dev-image-upload-originals`

Then add the values to the corresponding GCP Secret Manager secrets. For dev:

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

The Cloudflare output `gcp_r2_environment` should match the GCP Terraform
variables `r2_account_id`, `r2_bucket`, and `public_base_url`.
