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

# Superdemo-only helpers. Not shared with sibling demos.

# is_proxy_deployed_to_env <proxy_name> <env> <org> <token>
#
# Returns 0 if the proxy has any active revision deployed in <env>.
# Returns 1 otherwise (proxy missing, no deployments, or no deployment in env).
# Emits a one-line human-readable status to stdout.
is_proxy_deployed_to_env() {
  local proxy_name env org token outfile match
  proxy_name="$1"
  env="$2"
  org="$3"
  token="$4"

  outfile=$(mktemp /tmp/superdemo.listdeploy.XXXXXX)
  if ! apigeecli apis listdeploy --name "$proxy_name" \
        --org "$org" --token "$token" --disable-check >"$outfile" 2>/dev/null; then
    rm -f "$outfile"
    printf "  %s: not deployed to %s (proxy not found)\n" "$proxy_name" "$env"
    return 1
  fi

  match=$(jq -r --arg env "$env" \
    '[.deployments[]? | select(.environment == $env)] | length' \
    "$outfile" 2>/dev/null)
  rm -f "$outfile"

  if [[ "$match" =~ ^[0-9]+$ ]] && (( match > 0 )); then
    printf "  %s: already deployed to %s\n" "$proxy_name" "$env"
    return 0
  fi

  printf "  %s: not deployed to %s\n" "$proxy_name" "$env"
  return 1
}

# smoke_test_proxy <label> <method> <url> [curl_args...]
#
# Runs curl with the supplied method, URL and extra args, echoing only the
# HTTP status code to stdout. On a non-2xx response (or curl failure) the
# response body is printed to stderr so the deploy log shows what went wrong.
# Returns 0 if curl itself succeeded (network reachable, TLS OK), 1 otherwise.
# Caller decides pass/fail by inspecting the echoed code.
smoke_test_proxy() {
  local label method url code curl_status body_file
  label="$1"
  method="$2"
  url="$3"
  shift 3

  body_file=$(mktemp /tmp/smoke-body.XXXXXX)
  code=$(curl -s -o "$body_file" -w '%{http_code}' \
    -X "$method" "$url" "$@" --max-time 30)
  curl_status=$?

  if [[ "$code" != 2* ]]; then
    {
      printf '  [smoke_test_proxy] %s response (HTTP %s):\n' "$label" "$code"
      if [[ -s "$body_file" ]]; then
        sed 's/^/    /' "$body_file"
      else
        printf '    (empty body)\n'
      fi
    } >&2
  fi
  rm -f "$body_file"

  echo "$code"
  return $curl_status
}

# derive_demo_status <deploy_status> <test_status>
#
# Maps the deploy_status + test_status strings produced by deploy-superdemo.sh
# into one of "passing" / "failing" / "undeployed". Echoes the result.
#   - "deploy-failed"             → "undeployed"
#   - any test_status starting with "passed" → "passing"
#   - anything else               → "failing"
derive_demo_status() {
  local deploy_status="$1" test_status="$2"

  case "$deploy_status" in
    deploy-failed)
      echo "undeployed"
      return
      ;;
  esac

  case "$test_status" in
    passed*)
      echo "passing"
      ;;
    *)
      echo "failing"
      ;;
  esac
}

# build_secret_payload <out_file>
#
# Reads global env vars set by deploy-superdemo.sh and writes the nested-shape
# superdemo-config JSON to <out_file> via jq.
#
# Globals consumed:
#   APIGEE_HOST, PROJECT_ID
#   BASIC_QUOTA_TRIAL_KEY, BASIC_QUOTA_PREMIUM_KEY, BASIC_QUOTA_STATUS
#   LLM_SECURITY_KEY, MODEL_NAME, MODEL_ARMOR_REGION, LLM_SECURITY_STATUS
#   LLM_TOKEN_LIMITS_BRONZE_KEY, LLM_TOKEN_LIMITS_SILVER_KEY,
#   LLM_TOKEN_LIMITS_STATUS, REGION
#   MCP_ENDPOINT, MCP_CLIENT_ID, MCP_CLIENT_SECRET, MCP_STATUS
#
# Token limits below are mirrored from llm-token-limits-v2/aiproduct-*.json.
# If those files change, update these constants. (We do not read them at
# deploy time to keep edits inside superdemo/ per the project's scope rule.)
build_secret_payload() {
  local out_file="$1"
  jq -n \
    --arg apigee_host       "$APIGEE_HOST" \
    --arg project_id        "$PROJECT_ID" \
    --arg bq_trial_key      "$BASIC_QUOTA_TRIAL_KEY" \
    --arg bq_premium_key    "$BASIC_QUOTA_PREMIUM_KEY" \
    --arg bq_status         "$BASIC_QUOTA_STATUS" \
    --arg llm_key           "$LLM_SECURITY_KEY" \
    --arg llm_model         "$MODEL_NAME" \
    --arg llm_region        "$MODEL_ARMOR_REGION" \
    --arg llm_status        "$LLM_SECURITY_STATUS" \
    --arg ltl_bronze_key    "$LLM_TOKEN_LIMITS_BRONZE_KEY" \
    --arg ltl_silver_key    "$LLM_TOKEN_LIMITS_SILVER_KEY" \
    --arg ltl_status        "$LLM_TOKEN_LIMITS_STATUS" \
    --arg ltl_region        "$REGION" \
    --arg ltl_model         "$MODEL_NAME" \
    --arg mcp_endpoint      "$MCP_ENDPOINT" \
    --arg mcp_client_id     "$MCP_CLIENT_ID" \
    --arg mcp_client_secret "$MCP_CLIENT_SECRET" \
    --arg mcp_model         "$MODEL_NAME" \
    --arg mcp_region        "$REGION" \
    --arg mcp_status        "$MCP_STATUS" \
    --argjson ltl_bronze    2000 \
    --argjson ltl_silver    5000 \
    --argjson ltl_interval  5 \
    '{
      APIGEE_HOST: $apigee_host,
      PROJECT_ID:  $project_id,
      demos: {
        "basic-quota": {
          trial_key:   $bq_trial_key,
          premium_key: $bq_premium_key,
          status:      $bq_status
        },
        "llm-security": {
          key:                $llm_key,
          model_name:         $llm_model,
          model_armor_region: $llm_region,
          status:             $llm_status
        },
        "llm-token-limits-v2": {
          bronze_key:         $ltl_bronze_key,
          silver_key:         $ltl_silver_key,
          status:             $ltl_status,
          bronze_token_limit: $ltl_bronze,
          silver_token_limit: $ltl_silver,
          interval_minutes:   $ltl_interval,
          model:              $ltl_model,
          region:             $ltl_region
        },
        "apigee-mcp": {
          mcp_endpoint:  $mcp_endpoint,
          client_id:     $mcp_client_id,
          client_secret: $mcp_client_secret,
          model:         $mcp_model,
          region:        $mcp_region,
          status:        $mcp_status
        }
      }
    }' > "$out_file"
}

# fetch_app_key_for_product <app_name> <product_name>
#
# Echoes the consumerKey whose apiProducts[0].apiproduct matches <product_name>.
# Echoes empty string if no match or apigeecli fails.
# Used by superdemo to fetch bronze + silver keys from the sibling sample's
# shared developer app (ai-consumer-app-v2), where each credential is bound
# to a different AI Product.
fetch_app_key_for_product() {
  local app_name product key
  app_name="$1"
  product="$2"
  key=$(apigeecli apps get --name "$app_name" --org "$PROJECT" \
        --token "$TOKEN" --disable-check 2>/dev/null \
        | jq -r --arg p "$product" \
          '.[0].credentials[]
           | select(.apiProducts[0].apiproduct==$p)
           | .consumerKey' 2>/dev/null)
  if [[ -z "$key" || "$key" == "null" ]]; then
    echo ""
  else
    echo "$key"
  fi
}

# fetch_app_secret <app_name> -> echoes the first credential's consumerSecret or empty string
fetch_app_secret() {
  local app_name secret
  app_name="$1"
  secret=$(apigeecli apps get --name "$app_name" --org "$PROJECT" \
        --token "$TOKEN" --disable-check 2>/dev/null \
        | jq -r '.[0].credentials[0].consumerSecret' 2>/dev/null)
  if [[ -z "$secret" || "$secret" == "null" ]]; then
    echo ""
  else
    echo "$secret"
  fi
}
