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

# APIs and the backend SA ($APP_SA_EMAIL, with its roles) are provisioned by
# superdemo/terraform — run `terraform apply` first.

# ── Precondition: the secret the backend reads must have a version ────
if ! gcloud secrets versions access latest --secret="$SECRET_NAME" \
      --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo
  echo "WARN: secret '$SECRET_NAME' has no readable version. Run terraform apply"
  echo "      and deploy-superdemo.sh first; until then the backend will report"
  echo "      'unconfigured'. Deploying anyway."
fi

# ── Firestore database for the access allowlist ───────────────────────
echo
echo "============================================="
echo " Ensuring Firestore database (access allowlist)"
echo "============================================="
firestore_result=$(ensure_firestore_db "$PROJECT_ID" "$REGION")
firestore_rc=$?
echo "  (default) database: $firestore_result"
case $firestore_rc in
  0)
    firestore_status="ok ($firestore_result)"
    ;;
  2)
    firestore_status="unusable (Datastore mode)"
    echo "  WARN: the access allowlist needs a Native-mode Firestore database;"
    echo "        every sign-in will fail until that's resolved."
    overall_failed=1
    ;;
  *)
    firestore_status="failed ($firestore_result)"
    overall_failed=1
    ;;
esac

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
      --set-env-vars "^|^GOOGLE_CLOUD_PROJECT=$PROJECT_ID|FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-$PROJECT_ID}|AUTH_ENABLED=true" \
      --allow-unauthenticated \
      --quiet; then
  backend_status="failed"
  overall_failed=1
fi

# ── Resolve the backend URL → host for the frontend proxy ─────────────
BACKEND_URL=""
if [[ "$backend_status" == "deployed" ]]; then
  BACKEND_URL=$(cloud_run_service_url "$BACKEND_SERVICE" "$REGION" "$PROJECT_ID")
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

  # Vite reads .env.production at build time. gcloud run deploy --source can't
  # pass Docker build args, so materialise the public Firebase web config here.
  # Removed on exit so a failed deploy never leaves it behind. It is gitignored
  # (root .env.* rule) and not excluded by frontend/.gcloudignore, so it reaches
  # the Cloud Build context.
  FRONTEND_ENV_FILE="$superdemo_dir/frontend/.env.production"
  cat > "$FRONTEND_ENV_FILE" <<EOF
VITE_AUTH_ENABLED=true
VITE_FIREBASE_API_KEY=${FIREBASE_API_KEY:-}
VITE_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN:-}
VITE_FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-}
VITE_FIREBASE_APP_ID=${FIREBASE_APP_ID:-}
EOF
  trap 'rm -f "$FRONTEND_ENV_FILE"' EXIT

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
    FRONTEND_URL=$(cloud_run_service_url "$FRONTEND_SERVICE" "$REGION" "$PROJECT_ID")
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────
echo
echo "================================================================="
echo " Superdemo App Deployment Summary"
echo "================================================================="
echo
printf " %-20s %s\n" "Firestore:" "$firestore_status"
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
echo " First deploy? Make yourself an admin (needs roles/datastore.user):"
echo "   cd superdemo/backend && uv run python -m allowlist_store add-admin you@example.com"
echo " Then manage access from the app's Users link (top-right)."
echo
echo " Tear down with: ./superdemo/deploy/clean-superdemo-app.sh"
echo "================================================================="

exit $overall_failed
