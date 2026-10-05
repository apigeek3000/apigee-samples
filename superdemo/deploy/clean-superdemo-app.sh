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

# Tears down what deploy-superdemo-app.sh created: the two Cloud Run services.
# Best-effort throughout — missing resources are skipped, not treated as errors.
#
# Deliberately left in place:
#   - the backend service account and the superdemo-config secret
#     (owned by superdemo/terraform)
#   - the cloud-run-source-deploy Artifact Registry repo and its images
#     (shared by any --source deploy; delete manually if you want it gone)
#   - the Firestore superdemo database and its superdemo/allowlist document
#     (owned by superdemo/terraform, which never deletes it)

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
echo " Superdemo app cleanup complete!"
echo "============================================="
echo " Note: the app SA and superdemo-config secret (Terraform-owned), the"
echo " cloud-run-source-deploy Artifact Registry repo, and the Firestore access"
echo " allowlist (document superdemo/allowlist in the superdemo database) were"
echo " left in place."
