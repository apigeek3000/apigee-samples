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

# Imports superdemo resources that already exist in the project (e.g. created
# by the pre-Terraform deploy scripts) into this directory's Terraform state.
# Run once before `terraform apply`:
#
#   ./superdemo/terraform/import-existing.sh
#
# Safe to re-run: addresses already in state and resources that don't exist
# are skipped. Project, region, API list, roles and SA names are read from the
# Terraform config itself (terraform console, which loads terraform.tfvars),
# so they never drift from what plan/apply use. Exits non-zero
# only when importing an existing resource fails.

set -u

tfdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Must match semantic_cache.tf.
SEMANTIC_INDEX_NAME="semantic-cache-index"
SEMANTIC_ENDPOINT_NAME="semantic-cache-index-endpoint"
SEMANTIC_DEPLOYED_ID="semantic_cache_index_endpoint_deployment"
FIRESTORE_DATABASE="superdemo"
CONFIG_SECRET="superdemo-config"

# ── Pure helpers (tested in import-existing.test.sh) ──────────────────

# in_list <needle> <newline-separated list> — exact whole-line match.
in_list() {
  grep -qxF -- "$1" <<<"$2"
}

# sa_email <account_id> <project>
sa_email() {
  echo "$1@$2.iam.gserviceaccount.com"
}

# policy_has_member <policy_json> <role> <member>
#
# True when an unconditional binding for <role> lists <member>
# (google_project_iam_member without a condition only imports those).
policy_has_member() {
  jq -e --arg r "$2" --arg m "$3" \
    '[.bindings[]? | select(.role == $r and .condition == null) | .members[]?]
     | any(. == $m)' <<<"$1" >/dev/null 2>&1 || return 1
}

# vertex_id_by_display_name <list_json> <display_name>
#
# Prints the trailing id of the first resource in a `gcloud ai … list
# --format=json` result with that displayName; prints nothing if none.
vertex_id_by_display_name() {
  jq -r --arg n "$2" \
    '[.[]? | select(.displayName == $n) | .name][0] // empty | split("/") | last' \
    <<<"$1" 2>/dev/null
}

# endpoint_has_deployed_index <endpoint_list_json> <endpoint_display_name> <deployed_index_id>
endpoint_has_deployed_index() {
  jq -e --arg n "$2" --arg d "$3" \
    '[.[]? | select(.displayName == $n) | .deployedIndexes[]? | .id] | any(. == $d)' \
    <<<"$1" >/dev/null 2>&1 || return 1
}

# ── Import bookkeeping ────────────────────────────────────────────────
tf() {
  terraform -chdir="$tfdir" "$@"
}

state_list=""
n_imported=0
n_in_state=0
n_missing=0
failed_list=""

# try_import <address> <import_id> <exists_check_cmd...>
#
# Skips <address> if it's already in state, or if the check command fails
# (resource doesn't exist). Otherwise runs terraform import and records the
# outcome. The check only runs when needed, so re-runs make no extra API calls.
try_import() {
  local address="$1" id="$2"
  shift 2
  if in_list "$address" "$state_list"; then
    echo "  in state:  $address"
    n_in_state=$((n_in_state + 1))
    return 0
  fi
  if ! "$@"; then
    echo "  missing:   $address"
    n_missing=$((n_missing + 1))
    return 0
  fi
  echo "  importing: $address"
  if tf import -input=false "$address" "$id" >/dev/null; then
    n_imported=$((n_imported + 1))
  else
    echo "  FAILED:    $address ($id)"
    failed_list+="  $address"$'\n'
  fi
}

# ── Existence checks (gcloud) ─────────────────────────────────────────
sa_exists() {
  gcloud iam service-accounts describe "$1" --project="$project" >/dev/null 2>&1
}

secret_exists() {
  gcloud secrets describe "$1" --project="$project" >/dev/null 2>&1
}

firestore_db_exists() {
  gcloud firestore databases describe --database="$1" --project="$project" >/dev/null 2>&1
}

nonempty() {
  [[ -n "$1" ]]
}

main() {
  local cmd
  for cmd in terraform gcloud jq; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not found on PATH."; exit 1; }
  done

  tf init -input=false >/dev/null || { echo "ERROR: terraform init failed."; exit 1; }

  # terraform console evaluates one line at a time, so keep this on one line.
  # An unset required variable makes jsonencode fail, so cfg ends up empty.
  local cfg
  cfg=$(echo 'jsonencode({project = var.project_id, region = var.region, apis = local.apis, mcp_roles = local.mcp_roles, app_roles = local.app_roles, llm_security_roles = local.llm_security_roles, mcp_sa = var.mcp_service_account_name, app_sa = var.app_service_account_name, llm_security_sa = var.llm_security_service_account_name, semantic = var.enable_semantic_cache})' \
          | tf console 2>/dev/null | jq -r 'fromjson' 2>/dev/null)
  if ! jq -e '.project != "" and .region != "" and (.apis | length > 0)' <<<"$cfg" >/dev/null 2>&1; then
    echo "ERROR: could not read the Terraform config. Create superdemo/terraform/terraform.tfvars"
    echo "       from terraform.tfvars.example (project_id and region are required)."
    exit 1
  fi
  project=$(jq -r .project <<<"$cfg")
  region=$(jq -r .region <<<"$cfg")

  echo "============================================="
  echo " Importing existing superdemo resources"
  echo " project=$project region=$region"
  echo "============================================="

  # No state file yet → nothing in state.
  state_list=$(tf state list 2>/dev/null || true)

  local mcp_email app_email llm_security_email enabled_apis policy svc role
  mcp_email=$(sa_email "$(jq -r .mcp_sa <<<"$cfg")" "$project")
  app_email=$(sa_email "$(jq -r .app_sa <<<"$cfg")" "$project")
  llm_security_email=$(sa_email "$(jq -r .llm_security_sa <<<"$cfg")" "$project")
  enabled_apis=$(gcloud services list --enabled --project="$project" \
                   --format='value(config.name)' 2>/dev/null)
  policy=$(gcloud projects get-iam-policy "$project" --format=json 2>/dev/null)

  echo
  echo "APIs"
  while IFS= read -r svc; do
    try_import "google_project_service.apis[\"$svc\"]" "$project/$svc" \
      in_list "$svc" "$enabled_apis"
  done < <(jq -r '.apis[]' <<<"$cfg")

  echo
  echo "Service accounts and roles"
  try_import google_service_account.mcp "projects/$project/serviceAccounts/$mcp_email" \
    sa_exists "$mcp_email"
  try_import google_service_account.app "projects/$project/serviceAccounts/$app_email" \
    sa_exists "$app_email"
  try_import google_service_account.llm_security "projects/$project/serviceAccounts/$llm_security_email" \
    sa_exists "$llm_security_email"
  while IFS= read -r role; do
    try_import "google_project_iam_member.mcp[\"$role\"]" "$project $role serviceAccount:$mcp_email" \
      policy_has_member "$policy" "$role" "serviceAccount:$mcp_email"
  done < <(jq -r '.mcp_roles[]' <<<"$cfg")
  while IFS= read -r role; do
    try_import "google_project_iam_member.app[\"$role\"]" "$project $role serviceAccount:$app_email" \
      policy_has_member "$policy" "$role" "serviceAccount:$app_email"
  done < <(jq -r '.app_roles[]' <<<"$cfg")
  while IFS= read -r role; do
    try_import "google_project_iam_member.llm_security[\"$role\"]" "$project $role serviceAccount:$llm_security_email" \
      policy_has_member "$policy" "$role" "serviceAccount:$llm_security_email"
  done < <(jq -r '.llm_security_roles[]' <<<"$cfg")

  echo
  echo "Secret container and Firestore database"
  try_import google_secret_manager_secret.config "projects/$project/secrets/$CONFIG_SECRET" \
    secret_exists "$CONFIG_SECRET"
  try_import google_firestore_database.superdemo "projects/$project/databases/$FIRESTORE_DATABASE" \
    firestore_db_exists "$FIRESTORE_DATABASE"

  if [[ "$(jq -r .semantic <<<"$cfg")" == "true" ]]; then
    local ai_email indexes endpoints index_id endpoint_id
    ai_email=$(sa_email "ai-client" "$project")
    indexes=$(gcloud ai indexes list --project="$project" --region="$region" \
                --format=json 2>/dev/null)
    endpoints=$(gcloud ai index-endpoints list --project="$project" --region="$region" \
                  --format=json 2>/dev/null)
    index_id=$(vertex_id_by_display_name "$indexes" "$SEMANTIC_INDEX_NAME")
    endpoint_id=$(vertex_id_by_display_name "$endpoints" "$SEMANTIC_ENDPOINT_NAME")
    local endpoint_path="projects/$project/locations/$region/indexEndpoints/$endpoint_id"

    echo
    echo "Semantic cache (enable_semantic_cache = true)"
    try_import "google_service_account.ai_client[0]" "projects/$project/serviceAccounts/$ai_email" \
      sa_exists "$ai_email"
    try_import "google_project_iam_member.ai_client[0]" \
      "$project roles/aiplatform.user serviceAccount:$ai_email" \
      policy_has_member "$policy" "roles/aiplatform.user" "serviceAccount:$ai_email"
    try_import "google_vertex_ai_index.semantic_cache[0]" \
      "projects/$project/locations/$region/indexes/$index_id" \
      nonempty "$index_id"
    try_import "google_vertex_ai_index_endpoint.semantic_cache[0]" "$endpoint_path" \
      nonempty "$endpoint_id"
    try_import "google_vertex_ai_index_endpoint_deployed_index.semantic_cache[0]" \
      "$endpoint_path/deployedIndex/$SEMANTIC_DEPLOYED_ID" \
      endpoint_has_deployed_index "$endpoints" "$SEMANTIC_ENDPOINT_NAME" "$SEMANTIC_DEPLOYED_ID"
  fi

  echo
  echo "================================================================="
  echo " Import Summary"
  echo "================================================================="
  printf " %-20s %s\n" "Imported:" "$n_imported"
  printf " %-20s %s\n" "Already in state:" "$n_in_state"
  printf " %-20s %s\n" "Not found (skipped):" "$n_missing"
  if [[ -n "$failed_list" ]]; then
    echo
    echo " Failed imports:"
    printf "%s" "$failed_list"
    exit 1
  fi
  echo
  echo " Next: terraform -chdir=superdemo/terraform apply"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
