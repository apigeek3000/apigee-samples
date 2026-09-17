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

# Directory this library lives in (.../superdemo/deploy). Used to locate
# superdemo-owned proxy patches under patches/.
libdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# require_env_vars <hint> <var_name...>
#
# set -u-safe preflight for the vars sourced from secret.sh. shlib's
# check_shell_variables expands `${!var}` with no default, so a *wholly unset*
# var aborts with a cryptic "unbound variable" under `set -u` before it can
# report which var is missing. This checks first with `${!var:-}` (safe), and
# if any are empty/unset prints them plus <hint> and returns 1 (caller exits).
require_env_vars() {
  local hint="$1"; shift
  local missing=() v
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      missing+=("$v")
    fi
  done
  if (( ${#missing[@]} != 0 )); then
    printf "ERROR: missing required environment variable(s): %s\n" "${missing[*]}" >&2
    printf "%s\n" "$hint" >&2
    return 1
  fi
  return 0
}

# wait_for_sa <sa_email> <project> [max_attempts] [delay_seconds]
#
# A freshly created service account is not immediately visible to the IAM
# policy API, so `add-iam-policy-binding` can fail with "does not exist". Poll
# `describe` until the SA appears. Returns 0 once visible, 1 if it never does.
wait_for_sa() {
  local sa_email="$1" project="$2" max="${3:-12}" delay="${4:-5}" i
  for (( i = 1; i <= max; i++ )); do
    if gcloud iam service-accounts describe "$sa_email" \
          --project="$project" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

# grant_sa_role <project> <sa_email> <role> [max_attempts]
#
# add-iam-policy-binding is idempotent, but right after SA creation it can still
# fail transiently ("does not exist") while the new SA propagates to the IAM
# policy backend. Retry with a linear backoff. Returns 0 on success, 1 if all
# attempts fail.
grant_sa_role() {
  local project="$1" sa_email="$2" role="$3" max="${4:-5}" i
  for (( i = 1; i <= max; i++ )); do
    if gcloud projects add-iam-policy-binding "$project" \
          --member="serviceAccount:$sa_email" \
          --role="$role" \
          --condition=None \
          --quiet >/dev/null 2>&1; then
      return 0
    fi
    if (( i < max )); then
      sleep $(( i * 3 ))
    fi
  done
  return 1
}

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

# is_semantic_cache_index_ready <project> <region>
#
# Returns 0 iff a Vertex AI Vector Search index endpoint named
# "semantic-cache-index-endpoint" exists AND has an index deployed under the id
# "semantic_cache_index_endpoint_deployment" (the id the sibling proxy's
# SemanticCacheLookup policy targets). Used to gate the semantic-cache demo:
# the endpoint is slow to deploy (~20-30 min) and billed hourly, so
# deploy-superdemo.sh never provisions it — setup-semantic-cache-index.sh does.
is_semantic_cache_index_ready() {
  local project="$1" region="$2" count
  count=$(gcloud ai index-endpoints list \
            --project="$project" --region="$region" --format="json" 2>/dev/null \
          | jq -r '[.[]
              | select(.displayName == "semantic-cache-index-endpoint")
              | .deployedIndexes[]?
              | select(.id == "semantic_cache_index_endpoint_deployment")]
              | length' 2>/dev/null)
  [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 ))
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
    deploy-failed|"skipped (index prereq missing)")
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
#   CIRCUIT_BREAKING_STATUS, SECONDARY_REGION
#   PER_USER_BRONZE_KEY, PER_USER_SILVER_KEY, PER_USER_STATUS
#
# Token limits below are mirrored from llm-token-limits-v2/aiproduct-*.json.
# If those files change, update these constants. (We do not read them at
# deploy time to keep edits inside superdemo/ per the project's scope rule.)
build_secret_payload() {
  local out_file="$1"
  # tp_max_keys mirrors threat-protection/apiproxy/policies/JSONTHREAT-Protection.xml's
  # <ObjectEntryCount>5</ObjectEntryCount>. If that XML changes, update this too.
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
    --arg mcp_pro_model     "$PRO_MODEL_NAME" \
    --arg mcp_region        "$REGION" \
    --arg mcp_status        "$MCP_STATUS" \
    --arg cl_status         "$CLOUD_LOGGING_STATUS" \
    --arg cl_proxy_name     "sample-cloud-logging" \
    --arg tp_status         "$THREAT_PROTECTION_STATUS" \
    --argjson tp_max_keys   5 \
    --argjson tp_blocked    '["delete","exec","drop table","insert","shutdown","update","or"]' \
    --argjson ltl_bronze    2000 \
    --argjson ltl_silver    5000 \
    --argjson ltl_interval  5 \
    --arg cb_status         "$CIRCUIT_BREAKING_STATUS" \
    --arg cb_primary_region "$REGION" \
    --arg cb_secondary_region "$SECONDARY_REGION" \
    --arg cb_model          "$MODEL_NAME" \
    --argjson cb_threshold  2 \
    --argjson cb_window     2 \
    --arg pu_bronze_key     "$PER_USER_BRONZE_KEY" \
    --arg pu_silver_key     "$PER_USER_SILVER_KEY" \
    --arg pu_status         "$PER_USER_STATUS" \
    --arg pu_model          "$MODEL_NAME" \
    --arg pu_region         "$REGION" \
    --arg sc_status         "$SEMANTIC_CACHE_STATUS" \
    --arg sc_model          "$MODEL_NAME" \
    --arg sc_region         "$REGION" \
    --arg sc_embeddings     "$EMBEDDINGS_MODEL_ID" \
    --argjson sc_threshold  "$NEAREST_NEIGHBOR_DISTANCE" \
    --argjson sc_ttl        "$CACHE_ENTRY_TTL_SEC" \
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
          pro_model:     $mcp_pro_model,
          region:        $mcp_region,
          status:        $mcp_status
        },
        "cloud-logging": {
          status:     $cl_status,
          log_name:   ("projects/" + $project_id + "/logs/apigee"),
          proxy_name: $cl_proxy_name
        },
        "threat-protection": {
          status:                $tp_status,
          max_json_object_keys:  $tp_max_keys,
          blocked_keywords:      $tp_blocked
        },
        "llm-circuit-breaking": {
          status:             $cb_status,
          primary_region:     $cb_primary_region,
          secondary_region:   $cb_secondary_region,
          failover_threshold: $cb_threshold,
          window_minutes:     $cb_window,
          model:              $cb_model
        },
        "llm-token-limits-per-user": {
          bronze_key:         $pu_bronze_key,
          silver_key:         $pu_silver_key,
          status:             $pu_status,
          bronze_token_limit: $ltl_bronze,
          silver_token_limit: $ltl_silver,
          interval_minutes:   $ltl_interval,
          model:              $pu_model,
          region:             $pu_region
        },
        "llm-semantic-cache-v2": {
          status:               $sc_status,
          model:                $sc_model,
          region:               $sc_region,
          embeddings_model:     $sc_embeddings,
          similarity_threshold: $sc_threshold,
          ttl_seconds:          $sc_ttl
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

# inject_target_pool_step <xml_file> <policy_name>
#
# Inserts a <Step><Name><policy_name></Name></Step> immediately after every
# DC-Collect step in <xml_file>, editing it in place. Echoes the number of steps
# inserted.
#
# The sibling llm-circuit-breaking bundle has two DC-Collect steps and BOTH must
# be patched: one in the ProxyEndpoint PostFlow (the normal routing path) and one
# in the primary TargetEndpoint's LLMQuota FaultRule (the retry path — PostFlow
# does not run on faults, which is why the sibling repeats DC-Collect there).
#
# They need DIFFERENT policies, hence <policy_name>. In a FaultRule the message
# returned to the caller is `error`, not `response`, so the fault-path policy must
# name it explicitly (AM-Superdemo-Target-Pool-Error) or the headers are written
# to a message that is never sent. The sibling's own AM-Secondary-Retry does the
# same thing on that path.
inject_target_pool_step() {
  local xml_file="$1" policy="$2" tmp count
  tmp=$(mktemp /tmp/superdemo-patch.XXXXXX.xml)

  if [[ -z "$policy" ]]; then
    echo "ERROR: inject_target_pool_step requires a policy name" >&2
    rm -f "$tmp"
    echo 0
    return 1
  fi

  awk -v policy="$policy" '
    BEGIN { pending = 0 }
    {
      print
      is_anchor = ($0 ~ /<Name>DC-Collect<\/Name>/)
      # Same-line closing tag (e.g. a collapsed "<Step><Name>DC-Collect</Name></Step>")
      # must be handled on THIS line, not deferred — otherwise pending would stay
      # set and the injection would fire at the next unrelated </Step> instead.
      if (is_anchor && $0 ~ /<\/Step>/) {
        match($0, /^[ \t]*/)
        indent = substr($0, 1, RLENGTH)
        printf "%s<Step>\n%s  <Name>%s</Name>\n%s</Step>\n", \
          indent, indent, policy, indent
        pending = 0
        next
      }
      if (is_anchor) { pending = 1; next }
      if (pending == 1 && $0 ~ /<\/Step>/) {
        match($0, /^[ \t]*/)
        indent = substr($0, 1, RLENGTH)
        printf "%s<Step>\n%s  <Name>%s</Name>\n%s</Step>\n", \
          indent, indent, policy, indent
        pending = 0
      }
    }
  ' "$xml_file" > "$tmp"

  count=$(grep -c "<Name>${policy}</Name>" "$tmp" 2>/dev/null || true)
  [[ -z "$count" ]] && count=0
  mv "$tmp" "$xml_file"
  echo "$count"
}

# patch_circuit_breaking_bundle <sibling_dir>
#
# Copies <sibling_dir>/apiproxy into a fresh temp dir, injects the superdemo-owned
# AM-Superdemo-Target-Pool policy and its <Step>s, and writes vertex_config.properties
# from superdemo's own env vars. Echoes the temp dir path on success; the caller is
# responsible for `rm -rf`-ing it.
#
# The sibling sample is never written to — that's the whole point of the temp copy
# (superdemo's scope rule forbids edits outside superdemo/).
#
# We write vertex_config.properties ourselves rather than relying on the sibling
# deploy script having written it: superdemo skips that script when the proxy is
# already deployed, and the committed properties file is empty.
#
# Globals consumed: PROJECT, REGION, SECONDARY_REGION
# Returns 1 (with nothing on stdout) if either proxies/default.xml or
# targets/primary.xml yields fewer than 1 DC-Collect anchor — a loud failure is
# far better than silently deploying a proxy with no failover signal on one of
# the two paths (normal routing vs. the FaultRule retry path).
patch_circuit_breaking_bundle() {
  local sibling_dir="$1" work_dir n f p policy
  work_dir=$(mktemp -d /tmp/superdemo-cb.XXXXXX)

  if ! cp -R "$sibling_dir/apiproxy" "$work_dir/apiproxy"; then
    echo "ERROR: could not copy $sibling_dir/apiproxy" >&2
    rm -rf "$work_dir"
    return 1
  fi

  for p in AM-Superdemo-Target-Pool AM-Superdemo-Target-Pool-Error; do
    if ! cp "$libdir/patches/llm-circuit-breaking/${p}.xml" \
          "$work_dir/apiproxy/policies/"; then
      echo "ERROR: could not copy ${p}.xml into the bundle" >&2
      rm -rf "$work_dir"
      return 1
    fi
  done

  mkdir -p "$work_dir/apiproxy/resources/properties"
  cat > "$work_dir/apiproxy/resources/properties/vertex_config.properties" <<EOF
project_p1=$PROJECT
project_p2=$PROJECT
region_p1=$REGION
region_p2=$SECONDARY_REGION
EOF

  # Each file gets the variant that matches the flow its DC-Collect anchor sits
  # in. default.xml's is a normal PostFlow response; primary.xml's is inside the
  # LLMQuota FaultRule, where the message returned to the caller is `error`, not
  # `response` — so it needs the -Error variant or the headers are set on a
  # message that never reaches the browser.
  for f in "$work_dir/apiproxy/proxies/default.xml:AM-Superdemo-Target-Pool" \
           "$work_dir/apiproxy/targets/primary.xml:AM-Superdemo-Target-Pool-Error"; do
    policy="${f##*:}"
    f="${f%:*}"
    if [[ ! -f "$f" ]]; then
      echo "ERROR: expected bundle file missing: $f" >&2
      rm -rf "$work_dir"
      return 1
    fi
    n=$(inject_target_pool_step "$f" "$policy")
    # Require at least one insertion in EACH file individually — a sum-based
    # check would be fooled by both anchors landing in the same file (e.g. 2
    # in default.xml, 0 in primary.xml), silently leaving the retry path
    # (primary.xml's FaultRule) unpatched.
    if (( n < 1 )); then
      echo "ERROR: expected >=1 DC-Collect anchor in $f, found $n." >&2
      echo "       The sibling sample's proxy XML has probably changed upstream." >&2
      echo "       Refusing to deploy an unpatched proxy (the demo would show no failover signal)." >&2
      rm -rf "$work_dir"
      return 1
    fi
  done

  echo "$work_dir"
}

# ai_product_set_model <product_json> <model>
#
# Pure transform: echoes <product_json> with every llmOperations[].model rewritten
# to <model>, and the server-owned read-only fields stripped so the result can be
# PUT straight back to the Apigee API.
#
# Returns 1 (nothing on stdout) if the product has no llmOperationGroup with at
# least one llmOperation — i.e. it is not an AI product, so silently "patching"
# it would be meaningless.
ai_product_set_model() {
  local product_json="$1" model="$2"

  if ! jq -e '.llmOperationGroup.operationConfigs[]?.llmOperations[]? | .model' \
       <<<"$product_json" >/dev/null 2>&1; then
    return 1
  fi

  jq --arg m "$model" \
    '(.llmOperationGroup.operationConfigs[].llmOperations[].model) = $m
     | del(.createdAt, .lastModifiedAt)' <<<"$product_json"
}

# ai_product_all_models_are <product_json> <model>
#
# Returns 0 iff <product_json> has at least one llmOperation and every one of them
# binds <model>. The "at least one" half matters: it is what makes this usable to
# verify an update response, where an API error body would otherwise vacuously pass.
ai_product_all_models_are() {
  jq -e --arg m "$2" \
    '[.llmOperationGroup.operationConfigs[]?.llmOperations[]?.model]
     | length > 0 and all(. == $m)' <<<"$1" >/dev/null 2>&1
}

# patch_ai_product_model <product_name> <model>
#
# Rewrites the model bound to every llmOperation on <product_name> to <model>.
#
# Why this exists: llm-token-limits-v2's AI products (ai-product-{bronze,silver}-v2)
# hardcode "gemini-2.5-flash" in the sibling sample's aiproduct-*.json. An AI product's
# operation match includes the model, so when superdemo's MODEL_NAME is anything else
# (e.g. gemini-2.5-flash-lite) every call is rejected with
# keymanagement.service.InvalidAPICallAsNoApiProductMatchFound — a valid key, but no
# product covering that model. Rebinding the deployed product keeps the sibling sample
# on disk untouched (superdemo's scope rule) and survives a re-run.
#
# Echoes "unchanged" when every operation already binds <model> (no API write), or
# "patched" after a successful update. Returns 1 with a message on stderr otherwise.
#
# Globals consumed: PROJECT, TOKEN
patch_ai_product_model() {
  local product="$1" model="$2" url current updated response

  url="https://apigee.googleapis.com/v1/organizations/${PROJECT}/apiproducts/${product}"

  current=$(curl -s -H "Authorization: Bearer ${TOKEN}" "$url")
  if ! jq -e '.name' <<<"$current" >/dev/null 2>&1; then
    echo "ERROR: could not read API product $product" >&2
    echo "       $(jq -r '.error.message // .' <<<"$current" 2>/dev/null | head -n 1)" >&2
    return 1
  fi

  if ! updated=$(ai_product_set_model "$current" "$model"); then
    echo "ERROR: $product has no llmOperationGroup — not an AI product?" >&2
    echo "       The sibling sample's aiproduct-*.json has probably changed upstream." >&2
    return 1
  fi

  # Every operation already on the right model: skip the write so re-runs are quiet.
  if ai_product_all_models_are "$current" "$model"; then
    echo "unchanged"
    return 0
  fi

  response=$(curl -s -X PUT -H "Authorization: Bearer ${TOKEN}" \
               -H "Content-Type: application/json" \
               -d "$updated" "$url")

  # Verify against the response body, not curl's exit code: the Apigee API answers a
  # rejected update with HTTP 400 and a JSON error body, which curl still reports as
  # success. An error body has no llmOperations at all, which this predicate rejects.
  if ! ai_product_all_models_are "$response" "$model"; then
    echo "ERROR: $product update did not take: $(jq -r '.error.message // "unexpected response"' <<<"$response" 2>/dev/null | head -n 1)" >&2
    return 1
  fi

  echo "patched"
}
