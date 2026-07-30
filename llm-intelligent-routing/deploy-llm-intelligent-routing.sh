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

set -e

scriptdir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

source "${scriptdir}/../shlib/utils.sh"

# ====================================================================

check_shell_variables PROJECT_ID \
  APIGEE_ENV \
  APIGEE_HOST \
  REGION \
  SERVICE_ACCOUNT_NAME \
  SIMPLE_MODEL \
  COMPLEX_MODEL \
  EMBEDDINGS_MODEL_ID \
  ROUTING_MIN_SIMILARITY

check_required_commands gcloud jq curl sed

[[ -z "$TOKEN" ]] && TOKEN=$(gcloud auth print-access-token)

insure_apigeecli
get_sedi_args sedi_args

proxy_name="llm-intelligent-routing-v1"
product_name="llm-intelligent-routing-product"
dev_moniker="llm-intelligent-routing-developer"
app_name="llm-intelligent-routing-app"
dev_email="${dev_moniker}@acme.com"
kvm_name="llm-intelligent-routing-overrides"
index_display_name="llm-routing-index"
index_endpoint_display_name="llm-routing-index-endpoint"
deployed_index_id="llm_routing_index_endpoint_deployment"

# --- Service account ------------------------------------------------

create_service_account_if_necessary "${SERVICE_ACCOUNT_NAME}" "${PROJECT_ID}" \
  "For the Apigee LLM Intelligent Routing sample"
SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# shellcheck disable=SC2034
REQUIRED_ROLES=(
  "roles/aiplatform.user"
  "roles/iam.serviceAccountUser"
)

add_roles_to_service_account "$SA_EMAIL" "$PROJECT_ID" "REQUIRED_ROLES"

# --- Resolve Vector Search resources --------------------------------

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")"

INDEX_ID=$(gcloud ai indexes list --project="$PROJECT_ID" --region="$REGION" --format="json" |
  jq -c -r --arg n "$index_display_name" '.[] | select(.displayName==$n) | .name | split("/") | .[5]')

INDEX_ENDPOINT_ID=$(gcloud ai index-endpoints list --project="$PROJECT_ID" --region="$REGION" --format="json" |
  jq -c -r --arg n "$index_endpoint_display_name" '.[] | select(.displayName==$n) | .name | split("/") | .[5]')

PUBLIC_ENDPOINT_SUBDOMAIN=$(gcloud ai index-endpoints list --project="$PROJECT_ID" --region="$REGION" --format="json" |
  jq -c -r --arg n "$index_endpoint_display_name" '.[] | select(.displayName==$n) | .publicEndpointDomainName | split(".") | .[0]')

if [[ -z "$INDEX_ID" || -z "$INDEX_ENDPOINT_ID" || -z "$PUBLIC_ENDPOINT_SUBDOMAIN" ]]; then
  printf "\nCould not find the Vector Search index '%s' and endpoint '%s' in %s/%s.\n" \
    "$index_display_name" "$index_endpoint_display_name" "$PROJECT_ID" "$REGION"
  printf "Create and deploy them first - see docs/cloudshell-tutorial.md.\n"
  printf "Note that deploying an index to an endpoint takes 20-30 minutes.\n\n"
  exit 1
fi

# --- Seed the index with the complex exemplars ----------------------

printf "\nEmbedding %s complex exemplars...\n" "$(jq -r '.examples | length' "${scriptdir}/config/complex-examples.json")"

embed_request=$(mktemp /tmp/llm-routing.embed-req.XXXXXX.json)
embed_response=$(mktemp /tmp/llm-routing.embed-resp.XXXXXX.json)
upsert_request=$(mktemp /tmp/llm-routing.upsert-req.XXXXXX.json)
trap 'rm -f "$embed_request" "$embed_response" "$upsert_request"' EXIT

jq '{instances: [.examples[] | {content: .text}], parameters: {autoTruncate: true}}' \
  "${scriptdir}/config/complex-examples.json" >"$embed_request"

curl --fail --silent --show-error \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${EMBEDDINGS_MODEL_ID}:predict" \
  --header "Authorization: Bearer ${TOKEN}" \
  --header "Content-Type: application/json" \
  --data "@${embed_request}" >"$embed_response"

if ! jq -e -s '(.[0].examples | length) == (.[1].predictions | length)' \
  "${scriptdir}/config/complex-examples.json" "$embed_response" >/dev/null; then
  printf "\nThe embeddings API returned a different number of vectors than exemplars sent.\n"
  printf "Refusing to upsert - the datapoint IDs would be paired with the wrong vectors.\n\n"
  exit 1
fi

jq -s '.[0].examples as $e | {datapoints: [.[1].predictions | to_entries[] |
  {datapoint_id: $e[.key].id, feature_vector: .value.embeddings.values}]}' \
  "${scriptdir}/config/complex-examples.json" "$embed_response" >"$upsert_request"

printf "Upserting datapoints into index %s...\n" "$INDEX_ID"

curl --fail --silent --show-error \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/indexes/${INDEX_ID}:upsertDatapoints" \
  --header "Authorization: Bearer ${TOKEN}" \
  --header "Content-Type: application/json" \
  --data "@${upsert_request}" >/dev/null

printf "Index seeded.\n"

# --- Write the proxy property set -----------------------------------

cat >"${scriptdir}/proxybundles/${proxy_name}/apiproxy/resources/properties/vertex_config.properties" <<EOF
project_id=$PROJECT_ID
project_number=$PROJECT_NUMBER
region=$REGION
simple_model=$SIMPLE_MODEL
complex_model=$COMPLEX_MODEL
embeddings_model_id=$EMBEDDINGS_MODEL_ID
index_endpoint_id=$INDEX_ENDPOINT_ID
index_endpoint_subdomain=$PUBLIC_ENDPOINT_SUBDOMAIN
index_id_name=$deployed_index_id
routing_min_similarity=$ROUTING_MIN_SIMILARITY
EOF

# --- Overrides KVM --------------------------------------------------

if apigeecli kvms list -e "${APIGEE_ENV}" -o "$PROJECT_ID" --token "$TOKEN" | jq -e 'any(. == "'"$kvm_name"'")' >/dev/null; then
  printf "\nThe KVM %s already exists...\n" "$kvm_name"
else
  echo "Importing the routing overrides KVM"
  json_file="${scriptdir}/config/env__${APIGEE_ENV}__${kvm_name}__kvmfile__0.json"
  cp "${scriptdir}/config/env__envname__${kvm_name}__kvmfile__0.json" "$json_file"
  # shellcheck disable=SC2154
  sed "${sedi_args[@]}" "s/SIMPLE_MODEL/$SIMPLE_MODEL/g" "$json_file"
  sed "${sedi_args[@]}" "s/COMPLEX_MODEL/$COMPLEX_MODEL/g" "$json_file"
  apigeecli kvms import -f "$json_file" --org "$PROJECT_ID" --token "$TOKEN" 2>/dev/null
  rm "$json_file"
fi

# --- Proxy, product, developer, app ---------------------------------

cd "${scriptdir}"

import_and_deploy_apiproxy "$proxy_name" "$PROJECT_ID" "$APIGEE_ENV" "${SA_EMAIL}"

create_product_if_necessary "${product_name}" "$PROJECT_ID" "$APIGEE_ENV"
create_developer_if_necessary "$dev_moniker" "$PROJECT_ID" "LLM Intelligent Routing"
create_app_if_necessary "$app_name" "$PROJECT_ID" "$product_name" "$dev_email"

APIKEY=$(apigeecli apps get --name "${app_name}" --org "$PROJECT_ID" --token "$TOKEN" --disable-check | jq ."[0].credentials[0].consumerKey" -r)
PROXY_URL="https://$APIGEE_HOST/v1/samples/llm-intelligent-routing/v1/projects/$PROJECT_ID/locations/$REGION/publishers/google/models/auto:generateContent"

echo " "
echo "All the Apigee artifacts are successfully deployed!"
echo " "
echo "Note the literal model name 'auto' in the URL - Apigee chooses the real model."
echo " "
echo "A simple prompt should route to $SIMPLE_MODEL:"
echo " "
echo "curl -i --location \"$PROXY_URL\" \\"
echo "  --header \"Content-Type: application/json\" \\"
echo "  --header \"x-apikey: \$APIKEY\" \\"
echo "  --data '{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"What is the capital of France?\"}]}]}'"
echo " "
echo "A complex prompt should route to $COMPLEX_MODEL:"
echo " "
echo "curl -i --location \"$PROXY_URL\" \\"
echo "  --header \"Content-Type: application/json\" \\"
echo "  --header \"x-apikey: \$APIKEY\" \\"
echo "  --data '{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"Decompose our distributed monolith into services and explain the trade-offs of each boundary you draw.\"}]}]}'"
echo " "
echo "Check the x-routing-selected-model and x-routing-reason response headers."
echo " "
echo "Export this variable"
echo "  export APIKEY=$APIKEY"
echo " "
echo "You can now go back to the Colab notebook to test the sample."
echo "Your PROJECT_ID is: $PROJECT_ID"
echo "Your APIGEE_HOST is: $APIGEE_HOST"
echo "Your REGION is: $REGION"
echo "Your APIKEY is: $APIKEY"
