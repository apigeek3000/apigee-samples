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
