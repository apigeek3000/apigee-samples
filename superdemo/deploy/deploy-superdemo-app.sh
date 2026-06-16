#!/bin/bash

# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Deploys the superdemo web app (FastAPI backend + React SPA frontend) to two
# Cloud Run services:
#
#   superdemo-backend   the FastAPI reverse proxy (reads the superdemo-config secret)
#   superdemo-frontend  the built SPA, served by Caddy, which reverse-proxies
#                       /api/* to the backend so the browser sees one origin
#                       (no CORS needed).
#
# Run this AFTER deploy-superdemo.sh, which provisions the Apigee proxies and
# writes the superdemo-config secret the backend reads. Tear down with
# clean-superdemo-app.sh.
#
# Like deploy-superdemo.sh, this intentionally does not `set -e`: each step
# records its own status so the final summary always prints.

set -u

scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# scriptdir is .../superdemo/deploy; superdemo_dir is its parent; rootdir the repo root.
superdemo_dir="$(dirname "$scriptdir")"
rootdir="$(dirname "$superdemo_dir")"

source "${rootdir}/shlib/utils.sh"
source "${scriptdir}/lib.sh"

# ── Resolve project/region ────────────────────────────────────────────
# basic-quota uses PROJECT; llm-security-v2 uses PROJECT_ID. Keep both set.
if [ -z "${PROJECT:-}" ] && [ -n "${PROJECT_ID:-}" ]; then
  export PROJECT="$PROJECT_ID"
elif [ -n "${PROJECT:-}" ] && [ -z "${PROJECT_ID:-}" ]; then
  export PROJECT_ID="$PROJECT"
fi

# Friendly preflight before shlib's check_shell_variables, which would abort
# with a cryptic "unbound variable" under `set -u` if these are wholly unset.
require_env_vars "$(cat <<'HINT'
Did you forget to source your secrets? Run:

  source ./superdemo/deploy/secret.sh

(If you haven't created it yet, copy ./superdemo/deploy/env.sh to secret.sh,
fill in your project's values, then source it.)
HINT
)" PROJECT_ID REGION || exit 1

check_shell_variables PROJECT_ID REGION
check_required_commands gcloud

APP_SA_NAME="${APP_SERVICE_ACCOUNT_NAME:-superdemo-app-svc-acct}"
APP_SA_EMAIL="${APP_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BACKEND_SERVICE="superdemo-backend"
FRONTEND_SERVICE="superdemo-frontend"
SECRET_NAME="superdemo-config"

overall_failed=0

# ── Enable required APIs (idempotent) ─────────────────────────────────
echo "============================================="
echo " Enabling required Google Cloud APIs"
echo "============================================="
api_enable_status="ok"
if ! gcloud services enable \
      run.googleapis.com \
      cloudbuild.googleapis.com \
      artifactregistry.googleapis.com \
      --project="$PROJECT_ID"; then
  api_enable_status="failed"
  overall_failed=1
  echo "WARN: API enablement failed. Continuing so the summary still prints."
fi

# ── Precondition: the secret the backend reads must exist ─────────────
if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo
  echo "WARN: secret '$SECRET_NAME' not found. Run deploy-superdemo.sh first;"
  echo "      until it exists the backend will report 'unconfigured'. Deploying anyway."
fi

# ── Provision the backend service account + roles ─────────────────────
# The backend reads the secret, mints Vertex bearer tokens via ADC, and reads
# Cloud Logging entries for the cloud-logging demo. Grant exactly those roles.
echo
echo "============================================="
echo " Provisioning app service account"
echo "============================================="
if ! gcloud iam service-accounts describe "$APP_SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "  Creating $APP_SA_EMAIL..."
  if gcloud iam service-accounts create "$APP_SA_NAME" \
        --project="$PROJECT_ID" \
        --display-name="Superdemo app (Cloud Run) backend SA"; then
    # A new SA is not instantly visible to the IAM policy API; granting roles
    # too soon fails with "does not exist". Wait for it to propagate first.
    echo "  Waiting for $APP_SA_EMAIL to propagate..."
    if ! wait_for_sa "$APP_SA_EMAIL" "$PROJECT_ID"; then
      echo "  WARN: $APP_SA_EMAIL not visible yet; role grants will retry below."
    fi
  else
    echo "  WARN: failed to create $APP_SA_EMAIL"
    overall_failed=1
  fi
else
  echo "  $APP_SA_EMAIL already exists."
fi

# Grant roles (add-iam-policy-binding is idempotent). grant_sa_role retries with
# backoff to ride out any remaining IAM propagation lag after SA creation.
for role in \
    "roles/secretmanager.secretAccessor" \
    "roles/aiplatform.user" \
    "roles/logging.viewer"; do
  echo "  Granting $role to $APP_SA_EMAIL..."
  if ! grant_sa_role "$PROJECT_ID" "$APP_SA_EMAIL" "$role"; then
    echo "  WARN: failed to grant $role"
    overall_failed=1
  fi
done

# ── Deploy the backend ────────────────────────────────────────────────
echo
echo "============================================="
echo " Deploying $BACKEND_SERVICE to Cloud Run"
echo "============================================="
backend_status="deployed"
if ! gcloud run deploy "$BACKEND_SERVICE" \
      --source "$superdemo_dir/backend" \
      --region "$REGION" \
      --project "$PROJECT_ID" \
      --service-account "$APP_SA_EMAIL" \
      --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID" \
      --allow-unauthenticated \
      --quiet; then
  backend_status="failed"
  overall_failed=1
fi

# ── Resolve the backend URL → host for the frontend proxy ─────────────
BACKEND_URL=""
if [[ "$backend_status" == "deployed" ]]; then
  BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE" \
    --region "$REGION" --project "$PROJECT_ID" \
    --format 'value(status.url)' 2>/dev/null)
fi
BACKEND_HOST="${BACKEND_URL#https://}"

# ── Deploy the frontend (needs the backend host) ──────────────────────
echo
echo "============================================="
echo " Deploying $FRONTEND_SERVICE to Cloud Run"
echo "============================================="
FRONTEND_URL=""
if [[ -z "$BACKEND_HOST" ]]; then
  frontend_status="skipped (no backend host)"
  overall_failed=1
  echo "  Skipping: backend did not deploy, so there's no /api upstream to point at."
else
  echo "  Frontend will proxy /api/* to https://$BACKEND_HOST"
  frontend_status="deployed"
  if ! gcloud run deploy "$FRONTEND_SERVICE" \
        --source "$superdemo_dir/frontend" \
        --region "$REGION" \
        --project "$PROJECT_ID" \
        --set-env-vars "BACKEND_HOST=$BACKEND_HOST" \
        --allow-unauthenticated \
        --quiet; then
    frontend_status="failed"
    overall_failed=1
  else
    FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE" \
      --region "$REGION" --project "$PROJECT_ID" \
      --format 'value(status.url)' 2>/dev/null)
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────
echo
echo "================================================================="
echo " Superdemo App Deployment Summary"
echo "================================================================="
echo
printf " %-20s %s\n" "API enablement:" "$api_enable_status"
printf " %-20s %s\n" "$BACKEND_SERVICE:" "$backend_status"
printf " %-20s %s\n" "$FRONTEND_SERVICE:" "$frontend_status"
echo
if [[ -n "$BACKEND_URL" ]]; then
  printf " Backend URL:   %s\n" "$BACKEND_URL"
fi
if [[ -n "$FRONTEND_URL" ]]; then
  echo
  echo " 👉 Open the app:  $FRONTEND_URL"
fi
echo
if (( overall_failed != 0 )); then
  echo " One or more steps failed (exit code 1). See the log above."
fi
echo " Tear down with: ./superdemo/deploy/clean-superdemo-app.sh"
echo "================================================================="

exit $overall_failed
