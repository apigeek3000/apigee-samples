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

scriptdir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

source "${scriptdir}/../shlib/utils.sh"

# ====================================================================

check_shell_variables PROJECT_ID \
  APIGEE_ENV \
  REGION \
  SERVICE_ACCOUNT_NAME

check_required_commands gcloud jq curl

# shellcheck disable=SC2034
TOKEN=$(gcloud auth print-access-token)

insure_apigeecli

proxy_name="llm-intelligent-routing-v1"
product_name="llm-intelligent-routing-product"
dev_moniker="llm-intelligent-routing-developer"
app_name="llm-intelligent-routing-app"
dev_email="${dev_moniker}@acme.com"

delete_app_if_necessary "$app_name" "$PROJECT_ID" "$dev_email"
delete_developer_if_necessary "$dev_email" "$PROJECT_ID"
delete_product_if_necessary "$product_name" "$PROJECT_ID"
delete_apiproxy "${proxy_name}" "$PROJECT_ID"

# shellcheck disable=SC2034
ASSIGNED_ROLES=(
  "roles/aiplatform.user"
  "roles/iam.serviceAccountUser"
)

SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
remove_roles_from_service_account "$SA_EMAIL" "$PROJECT_ID" "ASSIGNED_ROLES"
delete_sa_if_necessary "$SA_EMAIL" "$PROJECT_ID"

printf "\nAll of the Apigee assets have been removed.\n"
printf "\nThe Vector Search index and endpoint were NOT deleted - they take 20-30 minutes\n"
printf "to recreate, and this script did not create them. To remove them yourself:\n\n"
printf "  INDEX_ENDPOINT_ID=\$(gcloud ai index-endpoints list --project=%s --region=%s \\\\\n" "$PROJECT_ID" "$REGION"
printf "    --format=\"json\" | jq -c -r '.[] | select(.displayName==\"llm-routing-index-endpoint\") | .name | split(\"/\") | .[5]')\n"
printf "  gcloud ai index-endpoints undeploy-index \"\$INDEX_ENDPOINT_ID\" \\\\\n"
printf "    --deployed-index-id=llm_routing_index_endpoint_deployment --project=%s --region=%s\n" "$PROJECT_ID" "$REGION"
printf "  gcloud ai index-endpoints delete \"\$INDEX_ENDPOINT_ID\" --project=%s --region=%s\n" "$PROJECT_ID" "$REGION"
printf "\n"
printf "  INDEX_ID=\$(gcloud ai indexes list --project=%s --region=%s \\\\\n" "$PROJECT_ID" "$REGION"
printf "    --format=\"json\" | jq -c -r '.[] | select(.displayName==\"llm-routing-index\") | .name | split(\"/\") | .[5]')\n"
printf "  gcloud ai indexes delete \"\$INDEX_ID\" --project=%s --region=%s\n\n" "$PROJECT_ID" "$REGION"
