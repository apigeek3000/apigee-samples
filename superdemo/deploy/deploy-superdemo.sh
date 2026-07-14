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

# NOTE: this script intentionally does not use `set -e`. We want the demo
# loop to keep running past individual failures so the final summary can
# show the full picture. Each step checks its own exit status and records
# the result; the script exits non-zero at the very end if anything failed.

scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# scriptdir is .../superdemo/deploy; rootdir is the repo root.
rootdir="$(dirname "$(dirname "$scriptdir")")"

source "${rootdir}/shlib/utils.sh"
source "${scriptdir}/lib.sh"

# ====================================================================
# The basic-quota demo uses PROJECT; llm-security-v2 uses PROJECT_ID.
# Ensure both are set consistently.
# ====================================================================

if [ -z "$PROJECT" ] && [ -n "$PROJECT_ID" ]; then
  export PROJECT="$PROJECT_ID"
elif [ -n "$PROJECT" ] && [ -z "$PROJECT_ID" ]; then
  export PROJECT_ID="$PROJECT"
fi

check_shell_variables PROJECT APIGEE_ENV APIGEE_HOST REGION

# llm-circuit-breaking fails over to a second Vertex backend. superdemo uses one
# project and two regions, so only the secondary region is configurable; it is
# optional and defaults to us-east1.
export SECONDARY_REGION="${SECONDARY_REGION:-us-east1}"

# The sibling llm-circuit-breaking deploy script expects P1/P2 project+region pairs
# and reads the org from APIGEE_PROJECT. Map superdemo's vars onto them.
export APIGEE_PROJECT="$PROJECT"
export PROJECT_P1="$PROJECT"
export PROJECT_P2="$PROJECT"
export REGION_P1="$REGION"
export REGION_P2="$SECONDARY_REGION"

# llm-security-v2 also requires these:
check_shell_variables PROJECT_ID SERVICE_ACCOUNT_NAME MODEL_NAME MODEL_ARMOR_REGION MODEL_ARMOR_TEMPLATE_ID

# apigee-mcp also requires:
check_shell_variables MCP_SERVICE_ACCOUNT_NAME SA_EMAIL

check_required_commands gcloud jq curl

# Tracks whether anything failed for the final exit code.
overall_failed=0

# ====================================================================
# Enable required GCP APIs (idempotent — no-op if already enabled)
# ====================================================================
echo "============================================="
echo " Enabling required Google Cloud APIs"
echo "============================================="
api_enable_status="ok"
if ! gcloud services enable \
      apigee.googleapis.com \
      secretmanager.googleapis.com \
      aiplatform.googleapis.com \
      modelarmor.googleapis.com \
      run.googleapis.com \
      apihub.googleapis.com \
      cloudtasks.googleapis.com \
      --project="$PROJECT"; then
  api_enable_status="failed"
  overall_failed=1
  echo "WARN: API enablement failed. Continuing so the summary still prints."
fi

# ====================================================================
# Set up tools used by the demo loop
# ====================================================================
insure_apigeecli
TOKEN=$(gcloud auth print-access-token)

# ====================================================================
# Provision the apigee-mcp runtime SA + grant roles.
# The three apigee-mcp proxies (crm-mcp-proxy, customers-api, mcp-spec-tools)
# are deployed with --sa "$SA_EMAIL". That identity needs roles/run.invoker
# (to call the Cloud Run targets) and roles/apihub.admin (so mcp-spec-tools
# can read specs from API hub at runtime).
# Idempotent: create_service_account_if_necessary is a no-op if the SA exists,
# and add_roles_to_service_account skips roles that are already bound.
# ====================================================================
echo
echo "============================================="
echo " Provisioning apigee-mcp service account"
echo "============================================="
create_service_account_if_necessary "${MCP_SERVICE_ACCOUNT_NAME}" "${PROJECT_ID}" "Apigee MCP demo runtime SA"

# Grant required roles inline rather than via shlib's add_roles_to_service_account.
# That helper relies on `declare -n` namerefs (bash 4+); macOS ships bash 3.2 by
# default, which fails with "declare: -n: invalid option". gcloud's
# add-iam-policy-binding is itself idempotent, so the simple loop here is
# functionally equivalent — it just skips the "check before binding" optimization.
for role in "roles/run.invoker" "roles/apihub.admin"; do
  echo "  Granting $role to $SA_EMAIL..."
  if ! gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --condition=None \
        --quiet >/dev/null; then
    echo "  WARN: failed to grant $role to $SA_EMAIL"
    overall_failed=1
  fi
done

# ====================================================================
# Demo registry
# ====================================================================
# Parallel arrays indexed by demo position. Adding a new demo means adding
# one entry to each array (and one branch in run_smoke_test).
demo_labels=(
  "basic-quota"
  "llm-security-v2"
  "llm-token-limits-v2"
  "apigee-mcp"
  "cloud-logging"
  "threat-protection"
  "llm-circuit-breaking"
  "llm-token-limits-per-user"
)
demo_proxy_names=(
  "basic-quota"
  "llm-security-v2"
  "llm-token-limits-v2"
  "crm-mcp-proxy"
  "sample-cloud-logging"
  "threat-protection"
  "llm-circuit-breaking-v1"
  "llm-token-limits-per-user-v1"
)
demo_deploy_dirs=(
  "$rootdir/basic-quota"
  "$rootdir/llm-security-v2"
  "$rootdir/llm-token-limits-v2"
  "$rootdir/apigee-mcp"
  "$rootdir/cloud-logging"
  "$rootdir/threat-protection"
  "$rootdir/llm-circuit-breaking"
  "$rootdir/llm-token-limits-per-user"
)
demo_deploy_cmds=(
  "./deploy-basic-quota.sh"
  "./deploy-llm-security-v2.sh"
  "./deploy-llm-token-limits-v2.sh"
  "./deploy-all.sh"
  "./deploy-cloud-logging.sh"
  "./deploy-threat-protection.sh"
  "./deploy-llm-circuit-breaking.sh"
  "./deploy-llm-token-limits-per-user.sh"
)

# Result accumulators, populated by the loop.
demo_deploy_status=()
demo_test_status=()

# Keys fetched per demo, used both for smoke tests and the Secret Manager write.
BASIC_QUOTA_TRIAL_KEY=""
BASIC_QUOTA_PREMIUM_KEY=""
LLM_SECURITY_KEY=""
LLM_TOKEN_LIMITS_BRONZE_KEY=""
LLM_TOKEN_LIMITS_SILVER_KEY=""
MCP_ENDPOINT=""
MCP_CLIENT_ID=""
MCP_CLIENT_SECRET=""
PER_USER_BRONZE_KEY=""
PER_USER_SILVER_KEY=""

# fetch_app_key <app_name> -> echoes the consumer key or empty string
fetch_app_key() {
  local app_name key
  app_name="$1"
  key=$(apigeecli apps get --name "$app_name" --org "$PROJECT" \
        --token "$TOKEN" --disable-check 2>/dev/null \
        | jq -r '.[0].credentials[0].consumerKey' 2>/dev/null)
  if [[ -z "$key" || "$key" == "null" ]]; then
    echo ""
  else
    echo "$key"
  fi
}

# fetch_keys_for_demo <label>
# Populates the persistent *_KEY globals for the demo's apps, and writes
# the smoke-test key for the demo to the global demo_smoke_key.
#
# This deliberately does NOT use $(fetch_keys_for_demo ...) — command
# substitution runs the callee in a subshell, and variable assignments
# made there do not propagate to the parent. Calling as a statement keeps
# the assignments in the parent shell.
demo_smoke_key=""
fetch_keys_for_demo() {
  local label
  label="$1"
  demo_smoke_key=""

  case "$label" in
    basic-quota)
      BASIC_QUOTA_TRIAL_KEY=$(fetch_app_key "basic-quota-trial-app")
      BASIC_QUOTA_PREMIUM_KEY=$(fetch_app_key "basic-quota-premium-app")
      demo_smoke_key="$BASIC_QUOTA_PREMIUM_KEY"
      ;;
    llm-security-v2)
      LLM_SECURITY_KEY=$(fetch_app_key "llm-security-app-v2")
      demo_smoke_key="$LLM_SECURITY_KEY"
      ;;
    llm-token-limits-v2)
      LLM_TOKEN_LIMITS_BRONZE_KEY=$(fetch_app_key_for_product \
        "ai-consumer-app-v2" "ai-product-bronze-v2")
      LLM_TOKEN_LIMITS_SILVER_KEY=$(fetch_app_key_for_product \
        "ai-consumer-app-v2" "ai-product-silver-v2")
      demo_smoke_key="$LLM_TOKEN_LIMITS_BRONZE_KEY"
      ;;
    apigee-mcp)
      MCP_CLIENT_ID=$(fetch_app_key "crm-consumer-app")
      MCP_CLIENT_SECRET=$(fetch_app_secret "crm-consumer-app")
      MCP_ENDPOINT="https://${APIGEE_HOST}/crm-mcp-proxy/sse"
      demo_smoke_key="$MCP_CLIENT_ID"
      ;;
    llm-token-limits-per-user)
      # The sibling creates one app with two credentials, each bound to a
      # different AI product.
      PER_USER_BRONZE_KEY=$(fetch_app_key_for_product \
        "ai-consumer-app-per-user" "ai-product-bronze-per-user")
      PER_USER_SILVER_KEY=$(fetch_app_key_for_product \
        "ai-consumer-app-per-user" "ai-product-silver-per-user")
      demo_smoke_key="$PER_USER_BRONZE_KEY"
      ;;
    cloud-logging|threat-protection|llm-circuit-breaking)
      # These demos' sibling proxies are unsecured (no VerifyAPIKey), so no
      # consumer key fetch is needed. Use a non-empty sentinel so the empty
      # check downstream still treats this as "we have what we need".
      demo_smoke_key="no-key-needed"
      ;;
  esac
}

# run_smoke_test <label> <smoke_key>
# Echoes the resulting test_status string. Caller records it.
run_smoke_test() {
  local label smoke_key code curl_ok url body
  label="$1"
  smoke_key="$2"

  case "$label" in
    basic-quota)
      url="https://$APIGEE_HOST/v1/samples/basic-quota?apikey=$smoke_key"
      code=$(smoke_test_proxy "$label" GET "$url")
      curl_ok=$?
      ;;
    llm-security-v2)
      url="https://$APIGEE_HOST/v2/samples/llm-security/v1/projects/$PROJECT_ID/locations/$MODEL_ARMOR_REGION/publishers/google/models/$MODEL_NAME:generateContent"
      body='{"contents":[{"role":"user","parts":[{"text":"ping"}]}],"generationConfig":{"candidateCount":1}}'
      # Note: this call reaches Vertex AI through the proxy and consumes a
      # small number of tokens per run.
      code=$(smoke_test_proxy "$label" POST "$url" \
              -H "Content-Type: application/json" \
              -H "x-apikey: $smoke_key" \
              -d "$body")
      curl_ok=$?
      ;;
    llm-token-limits-v2)
      url="https://$APIGEE_HOST/v2/samples/llm-token-limits/v1/projects/$PROJECT_ID/locations/$REGION/publishers/google/models/$MODEL_NAME:generateContent"
      # No generationConfig: with Gemini 2.5 Flash thinking enabled by default,
      # a tight maxOutputTokens cap (e.g. 8) gets consumed by thinking, the
      # response comes back without candidatesTokenCount, and the proxy's
      # LTQ-TokenCount policy faults with FailedToResolveTokenUsageCount → 500.
      # The default config produces a short reply at ~50-100 tokens, well below
      # the bronze 2000-token/5-min quota.
      body='{"contents":[{"role":"user","parts":[{"text":"ping"}]}]}'
      # The sibling proxy's target XML has no <GoogleAccessToken>, so Vertex
      # expects the caller to attach the OAuth bearer token (same pattern the
      # notebook uses via google-genai). Mint it from the operator's ADC.
      code=$(smoke_test_proxy "$label" POST "$url" \
              -H "Content-Type: application/json" \
              -H "x-apikey: $smoke_key" \
              -H "Authorization: Bearer $(gcloud auth print-access-token)" \
              -d "$body")
      curl_ok=$?
      ;;
    apigee-mcp)
      # crm-mcp-proxy enforces VerifyAPIKey on x-api-key. Connect to the SSE
      # endpoint and verify at least one `data:` line lands within 10s.
      # We don't check curl's exit code: curl exits non-zero on `--max-time`
      # even after streaming valid SSE data, so the presence of `data:` lines
      # is the authoritative signal.
      local sse_file
      sse_file=$(mktemp /tmp/mcp-sse.XXXXXX)
      curl -s -N --max-time 10 \
        -H "x-api-key: ${smoke_key}" \
        "${MCP_ENDPOINT}" 2>/dev/null | head -n 5 > "$sse_file"
      if grep -q '^data:' "$sse_file"; then
        rm -f "$sse_file"
        echo "passed (SSE handshake)"
        return
      fi
      rm -f "$sse_file"
      echo "failed (no SSE data within 10s)"
      return
      ;;
    cloud-logging)
      url="https://$APIGEE_HOST/v1/samples/cloud-logging"
      code=$(smoke_test_proxy "$label" GET "$url")
      curl_ok=$?
      ;;
    threat-protection)
      url="https://$APIGEE_HOST/v1/samples/threat-protection/json?query=select"
      code=$(smoke_test_proxy "$label" GET "$url")
      curl_ok=$?
      ;;
    llm-circuit-breaking)
      url="https://$APIGEE_HOST/v1/samples/llm-circuit-breaking/v1/projects/$PROJECT/locations/$REGION/publishers/google/models/$MODEL_NAME:generateContent"
      body='{"contents":[{"role":"user","parts":[{"text":"ping"}]}]}'
      # No VerifyAPIKey on this proxy, but its targets have no <GoogleAccessToken>,
      # so Vertex expects the caller to attach the OAuth bearer token.
      code=$(smoke_test_proxy "$label" POST "$url" \
              -H "Content-Type: application/json" \
              -H "Authorization: Bearer $(gcloud auth print-access-token)" \
              -d "$body")
      curl_ok=$?
      ;;
    llm-token-limits-per-user)
      url="https://$APIGEE_HOST/v1/samples/llm-token-limits-per-user/v1/projects/$PROJECT/locations/$REGION/publishers/google/models/$MODEL_NAME:generateContent"
      body='{"contents":[{"role":"user","parts":[{"text":"ping"}]}]}'
      code=$(smoke_test_proxy "$label" POST "$url" \
              -H "Content-Type: application/json" \
              -H "x-apikey: $smoke_key" \
              -H "x-userid: superdemo-smoke" \
              -H "Authorization: Bearer $(gcloud auth print-access-token)" \
              -d "$body")
      curl_ok=$?
      ;;
    *)
      echo "test-error (unknown demo)"
      return
      ;;
  esac

  if (( curl_ok != 0 )); then
    echo "test-error"
    return
  fi
  if [[ "$code" == "200" ]]; then
    echo "passed (HTTP 200)"
    return
  fi
  echo "failed (HTTP $code)"
}

# ====================================================================
# Demo loop
# ====================================================================
echo
echo "============================================="
echo " Demo deployment + smoke tests"
echo "============================================="

for i in "${!demo_labels[@]}"; do
  label="${demo_labels[$i]}"
  proxy_name="${demo_proxy_names[$i]}"
  deploy_dir="${demo_deploy_dirs[$i]}"
  deploy_cmd="${demo_deploy_cmds[$i]}"

  echo
  echo "--- $label ---"

  # Step 1: skip check
  deploy_status=""
  if is_proxy_deployed_to_env "$proxy_name" "$APIGEE_ENV" "$PROJECT" "$TOKEN"; then
    deploy_status="skipped (already deployed)"
  else
    echo "  Deploying $label..."
    if ( cd "$deploy_dir" && bash "$deploy_cmd" ); then
      deploy_status="deployed"
    else
      deploy_status="deploy-failed"
      overall_failed=1
    fi
  fi
  demo_deploy_status+=("$deploy_status")

  # llm-circuit-breaking's proxy records which target pool served a request only
  # into analytics vars, never into the response — so the UI would have nothing to
  # show. Redeploy a patched revision that also sets x-target-pool/x-target-region
  # response headers. The patch is applied to a temp copy; the sibling sample on
  # disk is never touched.
  if [[ "$label" == "llm-circuit-breaking" && "$deploy_status" != "deploy-failed" ]]; then
    echo "  Patching $label to expose the target pool in response headers..."
    if cb_work_dir=$(patch_circuit_breaking_bundle "$deploy_dir"); then
      cb_rev=$(apigeecli apis create bundle -f "$cb_work_dir/apiproxy" \
                 -n llm-circuit-breaking-v1 --org "$PROJECT" --token "$TOKEN" \
                 --disable-check | jq -r '.revision')
      if [[ -n "$cb_rev" && "$cb_rev" != "null" ]] && \
         apigeecli apis deploy --wait --name llm-circuit-breaking-v1 --ovr \
           --rev "$cb_rev" --org "$PROJECT" --env "$APIGEE_ENV" --token "$TOKEN"; then
        echo "  Patched revision $cb_rev deployed."
      else
        echo "  WARN: patched revision failed to deploy; the demo will show no failover signal."
        deploy_status="deploy-failed"
        demo_deploy_status[$i]="$deploy_status"
        overall_failed=1
      fi
      rm -rf "$cb_work_dir"
    else
      echo "  WARN: bundle patch failed; the demo will show no failover signal."
      deploy_status="deploy-failed"
      demo_deploy_status[$i]="$deploy_status"
      overall_failed=1
    fi
  fi

  # llm-token-limits-v2's AI products hardcode gemini-2.5-flash in the sibling's
  # aiproduct-*.json, and an AI product's operation match includes the model — so with
  # any other MODEL_NAME every call is rejected as "no apiproduct match found" even
  # though the key is valid. Rebind the deployed products to MODEL_NAME. The sibling
  # sample on disk is never touched.
  if [[ "$label" == "llm-token-limits-v2" && "$deploy_status" != "deploy-failed" ]]; then
    ltl_patched=0
    for ltl_product in ai-product-bronze-v2 ai-product-silver-v2; do
      if ltl_result=$(patch_ai_product_model "$ltl_product" "$MODEL_NAME"); then
        if [[ "$ltl_result" == "patched" ]]; then
          echo "  Rebound $ltl_product to $MODEL_NAME."
          ltl_patched=1
        fi
      else
        echo "  WARN: could not rebind $ltl_product to $MODEL_NAME; the demo will reject every call."
        overall_failed=1
      fi
    done
    # Apigee caches key→product resolution, so a smoke test fired immediately after
    # the rebind can still see the old model binding. Only wait when we actually wrote.
    if (( ltl_patched == 1 )); then
      echo "  Waiting 15s for the product change to propagate..."
      sleep 15
    fi
  fi

  # Step 2: key fetch + step 3: smoke test
  if [[ "$deploy_status" == "deploy-failed" ]]; then
    demo_test_status+=("skipped (deploy failed)")
    continue
  fi

  fetch_keys_for_demo "$label"
  if [[ -z "$demo_smoke_key" ]]; then
    demo_test_status+=("skipped (key-missing)")
    overall_failed=1
    continue
  fi

  echo "  Smoke testing $label..."
  test_status=$(run_smoke_test "$label" "$demo_smoke_key")
  demo_test_status+=("$test_status")
  case "$test_status" in
    "passed"*) ;;
    *) overall_failed=1 ;;
  esac
done

# ====================================================================
# Compute per-demo status and write Secret Manager only on payload diff
# ====================================================================
SECRET_NAME="superdemo-config"
secret_status=""

# Derive statuses (indexes match demo_labels order).
BASIC_QUOTA_STATUS=$(derive_demo_status "${demo_deploy_status[0]}" "${demo_test_status[0]}")
LLM_SECURITY_STATUS=$(derive_demo_status "${demo_deploy_status[1]}" "${demo_test_status[1]}")
LLM_TOKEN_LIMITS_STATUS=$(derive_demo_status "${demo_deploy_status[2]}" "${demo_test_status[2]}")
MCP_STATUS=$(derive_demo_status "${demo_deploy_status[3]}" "${demo_test_status[3]}")
export BASIC_QUOTA_STATUS LLM_SECURITY_STATUS LLM_TOKEN_LIMITS_STATUS MCP_STATUS
CLOUD_LOGGING_STATUS=$(derive_demo_status "${demo_deploy_status[4]}" "${demo_test_status[4]}")
THREAT_PROTECTION_STATUS=$(derive_demo_status "${demo_deploy_status[5]}" "${demo_test_status[5]}")
export CLOUD_LOGGING_STATUS THREAT_PROTECTION_STATUS
CIRCUIT_BREAKING_STATUS=$(derive_demo_status "${demo_deploy_status[6]}" "${demo_test_status[6]}")
PER_USER_STATUS=$(derive_demo_status "${demo_deploy_status[7]}" "${demo_test_status[7]}")
export CIRCUIT_BREAKING_STATUS PER_USER_STATUS

if [[ -z "$BASIC_QUOTA_PREMIUM_KEY" || -z "$LLM_SECURITY_KEY" || -z "$LLM_TOKEN_LIMITS_BRONZE_KEY" || -z "$LLM_TOKEN_LIMITS_SILVER_KEY" || -z "$MCP_CLIENT_ID" ]]; then
  secret_status="skipped (no usable keys)"
else
  tmpfile=$(mktemp /tmp/superdemo-config.XXXXXX.json)
  build_secret_payload "$tmpfile"
  new_payload=$(jq -S '.' "$tmpfile")

  secret_exists=0
  if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
    secret_exists=1
  fi

  echo
  echo "============================================="
  echo " Storing config in Google Secret Manager"
  echo "============================================="

  should_write=0
  if (( secret_exists == 0 )); then
    should_write=1
  else
    # On read failure, prefer to write — better to publish a fresh version
    # than to do nothing when we can't compare. Keep the gcloud and jq
    # exit codes separate so an empty/malformed read still surfaces the WARN.
    current_raw=$(gcloud secrets versions access latest \
          --secret="$SECRET_NAME" --project="$PROJECT" 2>/dev/null)
    gcloud_rc=$?
    current_payload=""
    if (( gcloud_rc == 0 )); then
      current_payload=$(printf '%s' "$current_raw" | jq -S '.' 2>/dev/null) || current_payload=""
    fi
    if (( gcloud_rc != 0 )) || [[ -z "$current_payload" ]]; then
      echo "WARN: could not read current secret version; will write a new one."
      should_write=1
    elif [[ "$current_payload" != "$new_payload" ]]; then
      should_write=1
    fi
  fi

  if (( should_write == 0 )); then
    secret_status="skipped (no changes)"
  else
    if (( secret_exists == 0 )); then
      if ! gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project="$PROJECT"; then
        secret_status="failed (create)"
        overall_failed=1
      fi
    fi

    if [[ -z "$secret_status" ]]; then
      if version_out=$(gcloud secrets versions add "$SECRET_NAME" \
            --data-file="$tmpfile" --project="$PROJECT" --format="value(name)" 2>&1); then
        version_id="${version_out##*/}"
        secret_status="updated ($SECRET_NAME v$version_id)"
      else
        secret_status="failed (versions add)"
        overall_failed=1
      fi
    fi
  fi

  rm -f "$tmpfile"
fi

# ====================================================================
# Summary
# ====================================================================
deploys_ok=0
tests_ok=0
total=${#demo_labels[@]}

for i in "${!demo_labels[@]}"; do
  case "${demo_deploy_status[$i]}" in
    "deployed"|"skipped"*) deploys_ok=$(( deploys_ok + 1 )) ;;
  esac
  case "${demo_test_status[$i]}" in
    "passed"*) tests_ok=$(( tests_ok + 1 )) ;;
  esac
done

echo
echo "================================================================="
echo " Superdemo Deployment Summary"
echo "================================================================="
echo
printf " %-17s %-28s %s\n" "Demo" "Deploy" "Smoke test"
printf " %-17s %-28s %s\n" "-----------------" "----------------------------" "--------------------------"
for i in "${!demo_labels[@]}"; do
  printf " %-17s %-28s %s\n" \
    "${demo_labels[$i]}" \
    "${demo_deploy_status[$i]}" \
    "${demo_test_status[$i]}"
done
echo
echo " API enablement:   $api_enable_status"
echo " Secret Manager:   $secret_status"
echo
echo " Result: $deploys_ok/$total deploys OK, $tests_ok/$total smoke tests passed"
if (( overall_failed != 0 )); then
  echo " Exit code: 1"
fi
echo
echo " Next steps: check superdemo/README.md"
echo "================================================================="

exit $overall_failed
