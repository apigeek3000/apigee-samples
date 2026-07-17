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

# Provisions (or tears down) the Vertex AI Vector Search index + endpoint the
# llm-semantic-cache-v2 proxy depends on. The sibling deploy script only READS
# these resources, so they must exist before deploy-superdemo.sh runs the
# semantic-cache demo. Deploying an index to an endpoint takes ~20-30 minutes
# and the endpoint is billed hourly while it exists.
#
# Usage:
#   source ./superdemo/deploy/secret.sh
#   ./superdemo/deploy/setup-semantic-cache-index.sh            # provision + wait
#   ./superdemo/deploy/setup-semantic-cache-index.sh --teardown # remove everything

set -euo pipefail

scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source "${scriptdir}/lib.sh"

# Ensure PROJECT / PROJECT_ID consistency (same pattern as deploy-superdemo.sh).
if [[ -z "${PROJECT:-}" && -n "${PROJECT_ID:-}" ]]; then
  export PROJECT="$PROJECT_ID"
fi

require_env_vars "source ./superdemo/deploy/secret.sh first" PROJECT REGION

INDEX_DISPLAY="semantic-cache-index"
ENDPOINT_DISPLAY="semantic-cache-index-endpoint"
DEPLOYED_INDEX_ID="semantic_cache_index_endpoint_deployment"
AI_CLIENT_SA="ai-client@${PROJECT}.iam.gserviceaccount.com"

TOKEN="${TOKEN:-$(gcloud auth print-access-token)}"

# find_index_id -> echoes the numeric index id, or empty.
find_index_id() {
  gcloud ai indexes list --project="$PROJECT" --region="$REGION" --format="json" 2>/dev/null \
    | jq -r --arg d "$INDEX_DISPLAY" \
        'first(.[] | select(.displayName == $d) | .name | split("/")[5]) // empty'
}

# find_endpoint_id -> echoes the numeric index-endpoint id, or empty.
find_endpoint_id() {
  gcloud ai index-endpoints list --project="$PROJECT" --region="$REGION" --format="json" 2>/dev/null \
    | jq -r --arg d "$ENDPOINT_DISPLAY" \
        'first(.[] | select(.displayName == $d) | .name | split("/")[5]) // empty'
}

teardown() {
  echo "Tearing down semantic-cache Vector Search resources..."
  local endpoint_id index_id
  endpoint_id=$(find_endpoint_id)
  if [[ -n "$endpoint_id" ]]; then
    echo "  Undeploying index from endpoint $endpoint_id (best-effort)..."
    gcloud ai index-endpoints undeploy-index "$endpoint_id" \
      --deployed-index-id="$DEPLOYED_INDEX_ID" \
      --project="$PROJECT" --region="$REGION" --quiet 2>/dev/null || true
    echo "  Deleting endpoint $endpoint_id..."
    gcloud ai index-endpoints delete "$endpoint_id" \
      --project="$PROJECT" --region="$REGION" --quiet 2>/dev/null || true
  else
    echo "  No index endpoint found; skipping."
  fi
  index_id=$(find_index_id)
  if [[ -n "$index_id" ]]; then
    echo "  Deleting index $index_id..."
    gcloud ai indexes delete "$index_id" \
      --project="$PROJECT" --region="$REGION" --quiet 2>/dev/null || true
  else
    echo "  No index found; skipping."
  fi
  echo "Teardown complete."
}

provision() {
  if is_semantic_cache_index_ready "$PROJECT" "$REGION"; then
    echo "Vector Search index endpoint is already deployed and ready. Nothing to do."
    return 0
  fi

  echo "Ensuring runtime service account $AI_CLIENT_SA exists..."
  if ! gcloud iam service-accounts describe "$AI_CLIENT_SA" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "ai-client" \
      --project="$PROJECT" \
      --display-name="Apigee semantic-cache runtime SA"
  fi
  wait_for_sa "$AI_CLIENT_SA" "$PROJECT"
  grant_sa_role "$PROJECT" "$AI_CLIENT_SA" "roles/aiplatform.user"

  local index_id endpoint_id
  index_id=$(find_index_id)
  if [[ -z "$index_id" ]]; then
    echo "Creating Vector Search index '$INDEX_DISPLAY' (STREAM_UPDATE, 768-dim)..."
    curl -s --fail-with-body --location --request POST \
      "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/indexes" \
      --header "Authorization: Bearer ${TOKEN}" \
      --header 'Content-Type: application/json' \
      --data-raw '{
        "displayName": "semantic-cache-index",
        "description": "semantic-cache-index",
        "metadata": {
          "config": {
            "dimensions": "768",
            "approximateNeighborsCount": 150,
            "distanceMeasureType": "DOT_PRODUCT_DISTANCE",
            "featureNormType": "NONE",
            "algorithmConfig": {
              "treeAhConfig": {
                "leafNodeEmbeddingCount": "10000",
                "fractionLeafNodesToSearch": 0.05
              }
            },
            "shardSize": "SHARD_SIZE_MEDIUM"
          }
        },
        "indexUpdateMethod": "STREAM_UPDATE"
      }'
    echo
    echo "  Waiting for the index to finish creating..."
    # Index creation is itself an LRO; poll until it appears in the list.
    until [[ -n "$(find_index_id)" ]]; do
      echo "    ...still creating; checking again in 30s"
      sleep 30
    done
    index_id=$(find_index_id)
  fi
  echo "  Index id: $index_id"

  endpoint_id=$(find_endpoint_id)
  if [[ -z "$endpoint_id" ]]; then
    echo "Creating index endpoint '$ENDPOINT_DISPLAY' (public)..."
    gcloud ai index-endpoints create \
      --display-name="$ENDPOINT_DISPLAY" \
      --public-endpoint-enabled \
      --project="$PROJECT" --region="$REGION"
    endpoint_id=$(find_endpoint_id)
  fi
  echo "  Endpoint id: $endpoint_id"

  echo "Deploying index $index_id to endpoint $endpoint_id..."
  echo "  This typically takes 20-30 minutes."
  gcloud ai index-endpoints deploy-index "$endpoint_id" \
    --deployed-index-id="$DEPLOYED_INDEX_ID" \
    --display-name="semantic-cache-index-endpoint-deployment" \
    --index="$index_id" \
    --project="$PROJECT" --region="$REGION"

  echo "  Waiting for the deployed index to become ready..."
  until is_semantic_cache_index_ready "$PROJECT" "$REGION"; do
    echo "    ...not ready yet; checking again in 60s"
    sleep 60
  done
  echo "Vector Search index endpoint is ready."
}

if [[ "${1:-}" == "--teardown" ]]; then
  teardown
else
  provision
fi
