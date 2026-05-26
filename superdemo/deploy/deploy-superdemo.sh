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

source "${rootdir}/shlib/utils.sh"

# ====================================================================
# The basic-quota demo uses PROJECT; llm-security-v2 uses PROJECT_ID.
# Ensure both are set consistently.
# ====================================================================

if [ -z "$PROJECT" ] && [ -n "$PROJECT_ID" ]; then
  export PROJECT="$PROJECT_ID"
elif [ -n "$PROJECT" ] && [ -z "$PROJECT_ID" ]; then
  export PROJECT_ID="$PROJECT"
fi

check_shell_variables PROJECT APIGEE_ENV APIGEE_HOST

# llm-security-v2 also requires these:
check_shell_variables PROJECT_ID SERVICE_ACCOUNT_NAME MODEL_NAME MODEL_ARMOR_REGION MODEL_ARMOR_TEMPLATE_ID

check_required_commands gcloud jq curl

# ====================================================================
# Enable required GCP APIs (idempotent — no-op if already enabled)
# ====================================================================
echo "============================================="
echo " Enabling required Google Cloud APIs"
echo "============================================="
gcloud services enable \
  apigee.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  modelarmor.googleapis.com \
  --project="$PROJECT"

# ====================================================================
# Deploy basic-quota
# ====================================================================
echo "============================================="
echo " Deploying Basic Quota"
echo "============================================="
cd "$rootdir/basic-quota"
./deploy-basic-quota.sh

# ====================================================================
# Deploy llm-security-v2
# ====================================================================
echo "============================================="
echo " Deploying LLM Security v2"
echo "============================================="
cd "$rootdir/llm-security-v2"
./deploy-llm-security-v2.sh

# ====================================================================
# Collect API keys and store in Secret Manager
# ====================================================================
cd "$rootdir"

TOKEN=$(gcloud auth print-access-token)
insure_apigeecli

echo "============================================="
echo " Collecting API keys"
echo "============================================="

BASIC_QUOTA_TRIAL_KEY=$(apigeecli apps get --name basic-quota-trial-app --org "$PROJECT" --token "$TOKEN" --disable-check | jq '.[0].credentials[0].consumerKey' -r)
BASIC_QUOTA_PREMIUM_KEY=$(apigeecli apps get --name basic-quota-premium-app --org "$PROJECT" --token "$TOKEN" --disable-check | jq '.[0].credentials[0].consumerKey' -r)
LLM_SECURITY_KEY=$(apigeecli apps get --name llm-security-app-v2 --org "$PROJECT" --token "$TOKEN" --disable-check | jq '.[0].credentials[0].consumerKey' -r)

tmpfile=$(mktemp /tmp/superdemo-config.XXXXXX.json)

cat <<EOF > "$tmpfile"
{
  "APIGEE_HOST": "$APIGEE_HOST",
  "PROJECT_ID": "$PROJECT_ID",
  "MODEL_NAME": "${MODEL_NAME}",
  "MODEL_ARMOR_REGION": "${MODEL_ARMOR_REGION}",
  "BASIC_QUOTA_TRIAL_KEY": "$BASIC_QUOTA_TRIAL_KEY",
  "BASIC_QUOTA_PREMIUM_KEY": "$BASIC_QUOTA_PREMIUM_KEY",
  "LLM_SECURITY_KEY": "$LLM_SECURITY_KEY"
}
EOF

echo "============================================="
echo " Storing config in Google Secret Manager"
echo "============================================="

SECRET_NAME="superdemo-config"

if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project="$PROJECT"
fi

gcloud secrets versions add "$SECRET_NAME" --data-file="$tmpfile" --project="$PROJECT"

rm "$tmpfile"

echo ""
echo "============================================="
echo " Superdemo deployment complete!"
echo "============================================="
echo ""
echo "Configuration saved to Secret Manager secret: $SECRET_NAME"
echo ""
echo "To run the web app:"
echo "  1. cd superdemo/backend && pip install -r requirements.txt"
echo "  2. GOOGLE_CLOUD_PROJECT=$PROJECT uvicorn main:app --reload"
echo "  3. cd superdemo/frontend && npm install && npm run dev"
echo ""
