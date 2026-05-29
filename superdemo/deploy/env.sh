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

# ---------------------------------------------------------------------
# Superdemo environment variables — sourced by deploy-superdemo.sh and
# inherited by the per-demo deploy scripts. Encapsulates everything
# basic-quota and llm-security-v2 need.
# ---------------------------------------------------------------------

# GCP project. Defaults to $GOOGLE_CLOUD_PROJECT if already exported
# (e.g. from the auth block in the README); otherwise edit this line.
export PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-<your-project-id>}"
export PROJECT="$PROJECT_ID"
export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"

# Apigee — shared by both demos
export APIGEE_ENV="<your-apigee-env>"
export APIGEE_HOST="<your-apigee-host>"

# Model Armor region. Pick one that meets your data-residency needs:
# https://docs.cloud.google.com/model-armor/data-residency
export MODEL_ARMOR_REGION="<your-model-armor-region>"

# Vertex AI region for llm-token-limits-v2 (used by the sibling sample's
# vertex_config.properties). Often the same as MODEL_ARMOR_REGION.
export REGION="<your-vertex-region>"

# Defaults — change only if you've customized your setup
export SERVICE_ACCOUNT_NAME="llm-security-v2-svc-acct"
export MCP_SERVICE_ACCOUNT_NAME="apigee-mcp-svc-acct"
export MODEL_ARMOR_TEMPLATE_ID="apigee-modelarmor-template"
export MODEL_NAME="gemini-2.5-flash"

# Apigee proxy runtime service account for the apigee-mcp demo. deploy-superdemo.sh
# creates this SA if missing and grants it roles/run.invoker (so the crm-mcp-proxy
# and customers-api proxies can invoke their Cloud Run targets) and roles/apihub.admin
# (so mcp-spec-tools can read specs from API hub at runtime). Override SA_EMAIL only
# if you have a pre-existing SA with these roles you'd rather reuse.
export SA_EMAIL="${MCP_SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
