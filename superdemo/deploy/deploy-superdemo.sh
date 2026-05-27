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

check_shell_variables PROJECT APIGEE_ENV APIGEE_HOST

# llm-security-v2 also requires these:
check_shell_variables PROJECT_ID SERVICE_ACCOUNT_NAME MODEL_NAME MODEL_ARMOR_REGION MODEL_ARMOR_TEMPLATE_ID

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
# Demo registry
# ====================================================================
# Parallel arrays indexed by demo position. Adding a new demo means adding
# one entry to each array (and one branch in run_smoke_test).
demo_labels=(
  "basic-quota"
  "llm-security-v2"
)
demo_proxy_names=(
  "basic-quota"
  "llm-security-v2"
)
demo_deploy_dirs=(
  "$rootdir/basic-quota"
  "$rootdir/llm-security-v2"
)
demo_deploy_cmds=(
  "./deploy-basic-quota.sh"
  "./deploy-llm-security-v2.sh"
)

# Result accumulators, populated by the loop.
demo_deploy_status=()
demo_test_status=()

# Keys fetched per demo, used both for smoke tests and the Secret Manager write.
BASIC_QUOTA_TRIAL_KEY=""
BASIC_QUOTA_PREMIUM_KEY=""
LLM_SECURITY_KEY=""

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
export BASIC_QUOTA_STATUS LLM_SECURITY_STATUS

if [[ -z "$BASIC_QUOTA_PREMIUM_KEY" || -z "$LLM_SECURITY_KEY" ]]; then
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
