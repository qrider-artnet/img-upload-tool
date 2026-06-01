#!/usr/bin/env bash
#
# Deploy the Upload Function as a Cloud Run (Cloud Run functions) service.
#
# The single source of truth for runtime configuration is the GCP Terraform state
# in infra/gcp. This script reads that state's outputs, so you must have applied the
# Terraform for the target environment first (see infra/gcp/README.md) and added the
# secret versions to Secret Manager.
#
# Usage:
#   npm run deploy            # deploys the "dev" environment
#   npm run deploy -- dev     # same, explicit
#
# Overridable via environment variables:
#   REGION                  GCP region (default: us-east4, per spec §2.2)
#   SERVICE_NAME            Cloud Run service name (default: artnet-<env>-upload-function)
#   ALLOW_UNAUTHENTICATED   set to "true" to make the service publicly invokable.
#                           NOT recommended: spec §2.5 expects authentication upstream
#                           at the API gateway and the service to require IAM invoker.
#
set -euo pipefail

ENV="${1:-dev}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TF_DIR="$(cd "${FUNCTION_DIR}/../infra/gcp" && pwd)"

REGION="${REGION:-us-east4}"
SERVICE_NAME="${SERVICE_NAME:-artnet-${ENV}-upload-function}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-false}"

# --- preflight ----------------------------------------------------------------
for bin in gcloud terraform jq; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "error: '${bin}' is required but not installed or not on PATH." >&2
    exit 1
  fi
done

tf_raw() { terraform -chdir="${TF_DIR}" output -raw "$1"; }

if ! tf_raw project_id >/dev/null 2>&1; then
  echo "error: cannot read Terraform outputs in ${TF_DIR}." >&2
  echo "       Apply the infra for this environment first (see infra/gcp/README.md)." >&2
  exit 1
fi

# --- read config from Terraform outputs (single source of truth) --------------
PROJECT_ID="$(tf_raw project_id)"
SERVICE_ACCOUNT="$(tf_raw runtime_service_account_email)"

R2_AK_SECRET="$(tf_raw r2_access_key_id_secret_name)"
R2_SK_SECRET="$(tf_raw r2_secret_access_key_secret_name)"
S3_AK_SECRET="$(tf_raw s3_source_access_key_id_secret_name)"
S3_SK_SECRET="$(tf_raw s3_source_secret_access_key_secret_name)"
REDIS_SECRET="$(tf_raw redis_url_secret_name)"

# Non-secret env vars -> temp YAML file (robust against commas in values such as
# S3_SOURCE_ALLOWED_BUCKETS, which --set-env-vars would mis-split).
ENV_VARS_FILE="$(mktemp)"
trap 'rm -f "${ENV_VARS_FILE}"' EXIT
terraform -chdir="${TF_DIR}" output -json upload_function_environment \
  | jq -r 'to_entries[] | "\(.key): \(.value | @json)"' >"${ENV_VARS_FILE}"

# Secret-backed env vars. Values stay in Secret Manager; only references are passed.
SECRETS="R2_ACCESS_KEY_ID=${R2_AK_SECRET}:latest"
SECRETS+=",R2_SECRET_ACCESS_KEY=${R2_SK_SECRET}:latest"
SECRETS+=",S3_SOURCE_ACCESS_KEY_ID=${S3_AK_SECRET}:latest"
SECRETS+=",S3_SOURCE_SECRET_ACCESS_KEY=${S3_SK_SECRET}:latest"
SECRETS+=",REDIS_URL=${REDIS_SECRET}:latest"

AUTH_FLAG="--no-allow-unauthenticated"
if [[ "${ALLOW_UNAUTHENTICATED}" == "true" ]]; then
  AUTH_FLAG="--allow-unauthenticated"
  echo "WARNING: deploying with --allow-unauthenticated. Spec §2.5 expects authentication" >&2
  echo "         upstream at the API gateway; the service should normally require IAM invoker." >&2
fi

echo "Deploying '${SERVICE_NAME}' to project '${PROJECT_ID}' in '${REGION}'..."

gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --source="${FUNCTION_DIR}" \
  --function=uploadFunction \
  --service-account="${SERVICE_ACCOUNT}" \
  --env-vars-file="${ENV_VARS_FILE}" \
  --set-secrets="${SECRETS}" \
  --concurrency=80 \
  --min-instances=1 \
  --max-instances=10 \
  --memory=512Mi \
  --timeout=60 \
  "${AUTH_FLAG}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"

echo
echo "Deployed. Service URL: ${SERVICE_URL}"
echo "Smoke test (requires an identity token if --no-allow-unauthenticated):"
echo "  curl -H \"Authorization: Bearer \$(gcloud auth print-identity-token)\" \"${SERVICE_URL}/v1/health\""
