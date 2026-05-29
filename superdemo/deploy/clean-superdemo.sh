#!/bin/bash

# Copyright 2025 Google LLC
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

set -e

scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# scriptdir is .../superdemo/deploy; rootdir is the repo root.
rootdir="$(dirname "$(dirname "$scriptdir")")"

# Ensure PROJECT / PROJECT_ID consistency
if [ -z "$PROJECT" ] && [ -n "$PROJECT_ID" ]; then
  export PROJECT="$PROJECT_ID"
elif [ -n "$PROJECT" ] && [ -z "$PROJECT_ID" ]; then
  export PROJECT_ID="$PROJECT"
fi

# ====================================================================
# Clean basic-quota
# ====================================================================
echo "============================================="
echo " Cleaning Basic Quota"
echo "============================================="
if [ -f "$rootdir/basic-quota/clean-up-basic-quota.sh" ]; then
  cd "$rootdir/basic-quota"
  ./clean-up-basic-quota.sh || true
fi

# ====================================================================
# Clean llm-security-v2
# ====================================================================
echo "============================================="
echo " Cleaning LLM Security v2"
echo "============================================="
if [ -f "$rootdir/llm-security-v2/clean-up-llm-security-v2.sh" ]; then
  cd "$rootdir/llm-security-v2"
  ./clean-up-llm-security-v2.sh || true
fi

# ====================================================================
# Clean llm-token-limits-v2
# ====================================================================
echo "============================================="
echo " Cleaning LLM Token Limits v2"
echo "============================================="
if [ -f "$rootdir/llm-token-limits-v2/undeploy-llm-token-limits-v2.sh" ]; then
  cd "$rootdir/llm-token-limits-v2"
  ./undeploy-llm-token-limits-v2.sh || true
fi

# ====================================================================
# apigee-mcp tear-down
# ====================================================================
echo
echo "--- apigee-mcp ---"

TOKEN=$(gcloud auth print-access-token)

# Undeploy + delete the three Apigee proxies created by apigee-mcp/deploy-all.sh.
for proxy in crm-mcp-proxy customers-api mcp-spec-tools; do
  echo "  Undeploying $proxy from $APIGEE_ENV..."
  REV=$(apigeecli apis listdeploy --name "$proxy" --org "$PROJECT" --token "$TOKEN" --disable-check 2>/dev/null \
        | jq -r --arg env "$APIGEE_ENV" '.deployments[]? | select(.environment==$env) | .revision' | head -n 1)
  if [[ -n "$REV" ]]; then
    apigeecli apis undeploy --name "$proxy" --rev "$REV" --org "$PROJECT" --env "$APIGEE_ENV" --token "$TOKEN" || true
  fi
  echo "  Deleting proxy $proxy..."
  apigeecli apis delete --name "$proxy" --org "$PROJECT" --token "$TOKEN" || true
done

# Delete the developer app, developer, and API products.
echo "  Deleting developer app crm-consumer-app..."
apigeecli apps delete --name crm-consumer-app --org "$PROJECT" --token "$TOKEN" || true

echo "  Deleting developer mcpconsumer@cymbal.com..."
apigeecli developers delete --email "mcpconsumer@cymbal.com" --org "$PROJECT" --token "$TOKEN" || true

for product in crm-product mcp-product; do
  echo "  Deleting API product $product..."
  apigeecli products delete --name "$product" --org "$PROJECT" --token "$TOKEN" || true
done

# Delete the KV resource that stored the RSA keypair.
echo "  Deleting oauth_configuration KV resource..."
apigeecli res delete --name oauth_configuration --org "$PROJECT" --env "$APIGEE_ENV" --token "$TOKEN" || true

# Delete the Cloud Run services.
for svc in crm-mcp-service customers-service; do
  echo "  Deleting Cloud Run service $svc in $REGION..."
  gcloud run services delete "$svc" --region "$REGION" --project "$PROJECT" --quiet 2>/dev/null || true
done

# Delete API hub spec for customers-api (best-effort).
echo "  Deleting API hub entry customers-api..."
apigeecli apihub apis delete --api-id customers-api --org "$PROJECT" -r "$REGION" --token "$TOKEN" 2>/dev/null || true

# Delete the apigee-mcp runtime service account (best-effort).
echo "  Deleting service account $SA_EMAIL..."
gcloud iam service-accounts delete "$SA_EMAIL" --project "$PROJECT" --quiet 2>/dev/null || true

# ====================================================================
# Delete Secret Manager secret
# ====================================================================
cd "$rootdir"

echo "============================================="
echo " Removing Secret Manager secret"
echo "============================================="
SECRET_NAME="superdemo-config"
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud secrets delete "$SECRET_NAME" --project="$PROJECT" --quiet
  echo "Deleted secret: $SECRET_NAME"
else
  echo "Secret $SECRET_NAME does not exist, skipping."
fi

echo ""
echo "============================================="
echo " Superdemo cleanup complete!"
echo "============================================="
