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

# Tears down what deploy-superdemo-app.sh created: the two Cloud Run services
# and the backend service account. Best-effort throughout — missing resources
# are skipped, not treated as errors.
#
# Deliberately left in place:
#   - the superdemo-config secret (owned by clean-superdemo.sh)
#   - the cloud-run-source-deploy Artifact Registry repo and its images
#     (shared by any --source deploy; delete manually if you want it gone)

set -u

# ── Resolve project/region ────────────────────────────────────────────
if [ -z "${PROJECT:-}" ] && [ -n "${PROJECT_ID:-}" ]; then
  export PROJECT="$PROJECT_ID"
elif [ -n "${PROJECT:-}" ] && [ -z "${PROJECT_ID:-}" ]; then
  export PROJECT_ID="$PROJECT"
fi

if [ -z "${PROJECT_ID:-}" ] || [ -z "${REGION:-}" ]; then
  echo "ERROR: PROJECT_ID and REGION must be set (source deploy/secret.sh)."
  exit 1
fi

APP_SA_NAME="${APP_SERVICE_ACCOUNT_NAME:-superdemo-app-svc-acct}"
APP_SA_EMAIL="${APP_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "============================================="
echo " Deleting superdemo app Cloud Run services"
echo "============================================="
for svc in superdemo-frontend superdemo-backend; do
  echo "  Deleting Cloud Run service $svc in $REGION..."
  gcloud run services delete "$svc" \
    --region "$REGION" --project "$PROJECT_ID" --quiet 2>/dev/null || true
done

echo
echo "============================================="
echo " Deleting app service account"
echo "============================================="
echo "  Deleting $APP_SA_EMAIL..."
gcloud iam service-accounts delete "$APP_SA_EMAIL" \
  --project "$PROJECT_ID" --quiet 2>/dev/null || true

echo
echo "============================================="
echo " Superdemo app cleanup complete!"
echo "============================================="
echo " Note: the superdemo-config secret and the cloud-run-source-deploy"
echo " Artifact Registry repo were left in place."
