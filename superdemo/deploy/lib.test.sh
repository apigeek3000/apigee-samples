#!/bin/bash
# Tests for superdemo/deploy/lib.sh helpers.
# Run with: bash superdemo/deploy/lib.test.sh

set -euo pipefail

scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source "$scriptdir/lib.sh"

fail=0

assert_equal() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"
    fail=1
  fi
}

echo "derive_demo_status: maps (deploy, smoke) outcomes → status string"
assert_equal "passing"    "$(derive_demo_status 'deployed' 'passed (HTTP 200)')"                  "  deployed + passed → passing"
assert_equal "passing"    "$(derive_demo_status 'skipped (already deployed)' 'passed (HTTP 200)')" "  already-deployed + passed → passing"
assert_equal "failing"    "$(derive_demo_status 'deployed' 'failed (HTTP 429)')"                  "  deployed + HTTP failure → failing"
assert_equal "failing"    "$(derive_demo_status 'deployed' 'test-error')"                         "  deployed + curl error → failing"
assert_equal "failing"    "$(derive_demo_status 'skipped (already deployed)' 'skipped (key-missing)')" "  already-deployed + missing API key → failing"
assert_equal "undeployed" "$(derive_demo_status 'deploy-failed' 'skipped (deploy failed)')"       "  deploy failed → undeployed"
assert_equal "undeployed" "$(derive_demo_status 'skipped (index prereq missing)' 'skipped (index prereq missing)')" "  index prereq missing → undeployed"

echo
echo "build_secret_payload: writes nested-shape superdemo-config JSON"
(
  export APIGEE_HOST="apigee.test.example.com"
  export PROJECT_ID="test-project"
  export BASIC_QUOTA_TRIAL_KEY="trial-key-123"
  export BASIC_QUOTA_PREMIUM_KEY="premium-key-456"
  export BASIC_QUOTA_STATUS="passing"
  export LLM_SECURITY_KEY="llm-key-789"
  export MODEL_NAME="gemini-fake"
  export PRO_MODEL_NAME="gemini-fake"
  export MODEL_ARMOR_REGION="us-central1"
  export LLM_SECURITY_STATUS="failing"
  export LLM_TOKEN_LIMITS_BRONZE_KEY="bronze-key-001"
  export LLM_TOKEN_LIMITS_SILVER_KEY="silver-key-002"
  export LLM_TOKEN_LIMITS_STATUS="passing"
  export REGION="us-east1"
  export MCP_ENDPOINT="https://apigee.test.example.com/crm-mcp-proxy/sse"
  export MCP_CLIENT_ID="mcp-key-001"
  export MCP_CLIENT_SECRET="mcp-secret-002"
  export MCP_STATUS="passing"
  export CLOUD_LOGGING_STATUS="passing"
  export THREAT_PROTECTION_STATUS="failing"
  export SECONDARY_REGION="us-east4"
  export CIRCUIT_BREAKING_STATUS="passing"
  export PER_USER_BRONZE_KEY="pu-bronze-003"
  export PER_USER_SILVER_KEY="pu-silver-004"
  export PER_USER_STATUS="passing"
  export SEMANTIC_CACHE_STATUS="passing"
  export EMBEDDINGS_MODEL_ID="text-embedding-005"
  export NEAREST_NEIGHBOR_DISTANCE="0.95"
  export CACHE_ENTRY_TTL_SEC="300"

  tmpfile=$(mktemp /tmp/superdemo-payload.XXXXXX.json)
  build_secret_payload "$tmpfile"
  actual=$(jq -S '.' "$tmpfile")
  rm -f "$tmpfile"

  expected=$(jq -S '.' <<'JSON'
{
  "APIGEE_HOST": "apigee.test.example.com",
  "PROJECT_ID": "test-project",
  "demos": {
    "basic-quota": {
      "trial_key": "trial-key-123",
      "premium_key": "premium-key-456",
      "status": "passing"
    },
    "llm-security": {
      "key": "llm-key-789",
      "model_name": "gemini-fake",
      "model_armor_region": "us-central1",
      "status": "failing"
    },
    "llm-token-limits-v2": {
      "bronze_key": "bronze-key-001",
      "silver_key": "silver-key-002",
      "status": "passing",
      "bronze_token_limit": 2000,
      "silver_token_limit": 5000,
      "interval_minutes": 5,
      "model": "gemini-fake",
      "region": "us-east1"
    },
    "apigee-mcp": {
      "mcp_endpoint": "https://apigee.test.example.com/crm-mcp-proxy/sse",
      "client_id": "mcp-key-001",
      "client_secret": "mcp-secret-002",
      "model": "gemini-fake",
      "pro_model": "gemini-fake",
      "region": "us-east1",
      "status": "passing"
    },
    "cloud-logging": {
      "status": "passing",
      "log_name": "projects/test-project/logs/apigee",
      "proxy_name": "sample-cloud-logging"
    },
    "threat-protection": {
      "status": "failing",
      "max_json_object_keys": 5,
      "blocked_keywords": ["delete","exec","drop table","insert","shutdown","update","or"]
    },
    "llm-circuit-breaking": {
      "status": "passing",
      "primary_region": "us-east1",
      "secondary_region": "us-east4",
      "failover_threshold": 2,
      "window_minutes": 2,
      "model": "gemini-fake"
    },
    "llm-token-limits-per-user": {
      "bronze_key": "pu-bronze-003",
      "silver_key": "pu-silver-004",
      "status": "passing",
      "bronze_token_limit": 2000,
      "silver_token_limit": 5000,
      "interval_minutes": 5,
      "model": "gemini-fake",
      "region": "us-east1"
    },
    "llm-semantic-cache-v2": {
      "status": "passing",
      "model": "gemini-fake",
      "region": "us-east1",
      "embeddings_model": "text-embedding-005",
      "similarity_threshold": 0.95,
      "ttl_seconds": 300
    }
  }
}
JSON
)

  if [[ "$actual" == "$expected" ]]; then
    echo "PASS:   demos.{basic-quota,llm-security,llm-token-limits-v2,apigee-mcp,cloud-logging,threat-protection,llm-circuit-breaking,llm-token-limits-per-user} populated"
  else
    echo "FAIL:   payload mismatch — diff:"
    diff <(echo "$expected") <(echo "$actual") || true
    exit 1
  fi
) || fail=1

echo
echo "fetch_app_key_for_product: extracts the right credential via jq"
(
  # Stub apigeecli to return a canned apps-get payload with two credentials.
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  cat > "$stub_dir/apigeecli" <<'STUB'
#!/bin/bash
cat <<'JSON'
[
  {
    "name": "ai-consumer-app-v2",
    "credentials": [
      {
        "consumerKey": "bronze-key-abc",
        "apiProducts": [{ "apiproduct": "ai-product-bronze-v2" }]
      },
      {
        "consumerKey": "silver-key-xyz",
        "apiProducts": [{ "apiproduct": "ai-product-silver-v2" }]
      }
    ]
  }
]
JSON
STUB
  chmod +x "$stub_dir/apigeecli"
  export PATH="$stub_dir:$PATH"
  export PROJECT=fake
  export TOKEN=fake

  bronze=$(fetch_app_key_for_product "ai-consumer-app-v2" "ai-product-bronze-v2")
  silver=$(fetch_app_key_for_product "ai-consumer-app-v2" "ai-product-silver-v2")
  missing=$(fetch_app_key_for_product "ai-consumer-app-v2" "ai-product-gold-v2")

  rm -rf "$stub_dir"

  if [[ "$bronze" == "bronze-key-abc" && "$silver" == "silver-key-xyz" && -z "$missing" ]]; then
    echo "PASS:   bronze/silver keys picked; unknown product returns empty"
  else
    echo "FAIL:   got bronze='$bronze' silver='$silver' missing='$missing'"
    exit 1
  fi
) || fail=1

echo
echo "fetch_app_secret: extracts the consumerSecret of the first credential"
(
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  cat > "$stub_dir/apigeecli" <<'STUB'
#!/bin/bash
cat <<'JSON'
[
  {
    "name": "crm-consumer-app",
    "credentials": [
      {
        "consumerKey": "key-abc",
        "consumerSecret": "secret-xyz"
      }
    ]
  }
]
JSON
STUB
  chmod +x "$stub_dir/apigeecli"
  export PATH="$stub_dir:$PATH"
  export PROJECT=fake
  export TOKEN=fake

  got=$(fetch_app_secret "crm-consumer-app")
  rm -rf "$stub_dir"

  if [[ "$got" == "secret-xyz" ]]; then
    echo "PASS:   consumerSecret returned for first credential"
  else
    echo "FAIL:   expected 'secret-xyz', got '$got'"
    exit 1
  fi
) || fail=1

echo
echo "fetch_app_secret: returns empty when apigeecli output has no secret"
(
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  cat > "$stub_dir/apigeecli" <<'STUB'
#!/bin/bash
cat <<'JSON'
[
  {
    "name": "crm-consumer-app",
    "credentials": [
      { "consumerKey": "key-abc" }
    ]
  }
]
JSON
STUB
  chmod +x "$stub_dir/apigeecli"
  export PATH="$stub_dir:$PATH"
  export PROJECT=fake
  export TOKEN=fake

  got=$(fetch_app_secret "crm-consumer-app")
  rm -rf "$stub_dir"

  if [[ -z "$got" ]]; then
    echo "PASS:   missing secret → empty string"
  else
    echo "FAIL:   expected empty, got '$got'"
    exit 1
  fi
) || fail=1

echo
echo "require_env_vars: set -u-safe; lists missing vars + hint, passes when all set"
(
  set -u
  # A wholly-unset var must NOT trip "unbound variable" the way shlib does.
  unset DEMO_A DEMO_B 2>/dev/null || true
  out=$(require_env_vars "source your secrets" DEMO_A DEMO_B 2>&1)
  rc=$?
  if (( rc == 1 )) \
     && [[ "$out" == *"DEMO_A DEMO_B"* ]] \
     && [[ "$out" == *"source your secrets"* ]]; then
    echo "PASS:   missing vars reported with hint, exit 1"
  else
    echo "FAIL:   rc=$rc out='$out'"
    exit 1
  fi

  export DEMO_A=set DEMO_B=set
  if require_env_vars "hint" DEMO_A DEMO_B >/dev/null 2>&1; then
    echo "PASS:   all-set returns 0"
  else
    echo "FAIL:   expected 0 when all vars set"
    exit 1
  fi
) || fail=1

echo
echo "wait_for_sa: returns once describe succeeds, fails if it never does"
(
  # Stub gcloud to succeed only on the 2nd describe call (counter via temp file).
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  count_file="$stub_dir/count"
  echo 0 > "$count_file"
  cat > "$stub_dir/gcloud" <<STUB
#!/bin/bash
n=\$(cat "$count_file")
n=\$((n + 1))
echo "\$n" > "$count_file"
[[ "\$n" -ge 2 ]]
STUB
  chmod +x "$stub_dir/gcloud"
  export PATH="$stub_dir:$PATH"

  # Override sleep so the test doesn't actually wait.
  sleep() { :; }

  if wait_for_sa "sa@x.iam.gserviceaccount.com" "proj" 5 0; then
    echo "PASS:   succeeds once SA becomes visible"
  else
    echo "FAIL:   expected success within max attempts"
    rm -rf "$stub_dir"; exit 1
  fi

  echo 0 > "$count_file"
  # Now make describe always fail and cap attempts low.
  cat > "$stub_dir/gcloud" <<'STUB'
#!/bin/bash
exit 1
STUB
  chmod +x "$stub_dir/gcloud"
  if wait_for_sa "sa@x.iam.gserviceaccount.com" "proj" 2 0; then
    echo "FAIL:   expected failure when SA never appears"
    rm -rf "$stub_dir"; exit 1
  else
    echo "PASS:   fails when SA never appears"
  fi
  rm -rf "$stub_dir"
) || fail=1

echo
echo "grant_sa_role: retries transient failures, succeeds on a later attempt"
(
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  count_file="$stub_dir/count"
  echo 0 > "$count_file"
  # Fail the first 2 binding attempts (simulating IAM propagation), then succeed.
  cat > "$stub_dir/gcloud" <<STUB
#!/bin/bash
n=\$(cat "$count_file")
n=\$((n + 1))
echo "\$n" > "$count_file"
[[ "\$n" -ge 3 ]]
STUB
  chmod +x "$stub_dir/gcloud"
  export PATH="$stub_dir:$PATH"
  sleep() { :; }

  if grant_sa_role "proj" "sa@x.iam.gserviceaccount.com" "roles/foo" 5; then
    attempts=$(cat "$count_file")
    rm -rf "$stub_dir"
    if [[ "$attempts" == "3" ]]; then
      echo "PASS:   succeeded on attempt 3 after retrying"
    else
      echo "FAIL:   expected 3 attempts, got $attempts"
      exit 1
    fi
  else
    rm -rf "$stub_dir"
    echo "FAIL:   expected eventual success"
    exit 1
  fi
) || fail=1

echo
echo "inject_target_pool_step: inserts a Step after each DC-Collect step"
(
  fixture=$(mktemp /tmp/superdemo-inject.XXXXXX.xml)
  cat > "$fixture" <<'XML'
<ProxyEndpoint name="default">
  <PostFlow name="PostFlow">
    <Response>
      <Step>
        <Name>DC-Collect</Name>
      </Step>
    </Response>
  </PostFlow>
</ProxyEndpoint>
XML

  count=$(inject_target_pool_step "$fixture" AM-Superdemo-Target-Pool)
  body=$(cat "$fixture")
  rm -f "$fixture"

  if [[ "$count" != "1" ]]; then
    echo "FAIL:   expected 1 insertion, got '$count'"
    exit 1
  fi
  if ! grep -q '<Name>AM-Superdemo-Target-Pool</Name>' <<<"$body"; then
    echo "FAIL:   injected step not present in output"
    exit 1
  fi
  # The injected step must come AFTER the DC-Collect step, not before it.
  dc_line=$(grep -n '<Name>DC-Collect</Name>' <<<"$body" | cut -d: -f1)
  inj_line=$(grep -n '<Name>AM-Superdemo-Target-Pool</Name>' <<<"$body" | cut -d: -f1)
  if (( inj_line <= dc_line )); then
    echo "FAIL:   injected step (line $inj_line) is not after DC-Collect (line $dc_line)"
    exit 1
  fi
  echo "PASS:   one Step injected after DC-Collect, in order"
) || fail=1

echo
echo "inject_target_pool_step: reports 0 insertions when no DC-Collect anchor exists"
(
  fixture=$(mktemp /tmp/superdemo-inject.XXXXXX.xml)
  cat > "$fixture" <<'XML'
<ProxyEndpoint name="default">
  <PostFlow name="PostFlow">
    <Response/>
  </PostFlow>
</ProxyEndpoint>
XML

  count=$(inject_target_pool_step "$fixture" AM-Superdemo-Target-Pool)
  rm -f "$fixture"

  if [[ "$count" != "0" ]]; then
    echo "FAIL:   expected 0 insertions, got '$count'"
    exit 1
  fi
  echo "PASS:   no anchor → 0 insertions"
) || fail=1

echo
echo "inject_target_pool_step: places the injection right after a single-line <Step><Name>DC-Collect</Name></Step>"
(
  # Mirrors the shape of targets/primary.xml: a FaultRule whose DC-Collect step
  # has collapsed onto one line, followed (much later) by an unrelated PreFlow
  # step. The buggy awk's `next` on the same-line match skips the same-line
  # </Step> check, leaving `pending` set until the NEXT </Step> anywhere in the
  # file — which here is the unrelated PreFlow step, not DC-Collect.
  fixture=$(mktemp /tmp/superdemo-inject.XXXXXX.xml)
  cat > "$fixture" <<'XML'
<TargetEndpoint name="primary">
  <FaultRules>
    <FaultRule name="LLMQuota">
      <Step>
        <Name>Q-LLM-Failover-Counter</Name>
      </Step>
      <Step><Name>DC-Collect</Name></Step>
    </FaultRule>
  </FaultRules>
  <PreFlow name="PreFlow">
    <Request>
      <Step>
        <Name>AM-Path-Suffix</Name>
      </Step>
    </Request>
  </PreFlow>
</TargetEndpoint>
XML

  count=$(inject_target_pool_step "$fixture" AM-Superdemo-Target-Pool-Error)
  body=$(cat "$fixture")
  rm -f "$fixture"

  if [[ "$count" != "1" ]]; then
    echo "FAIL:   expected 1 insertion, got '$count'"
    exit 1
  fi

  dc_line=$(grep -n '<Name>DC-Collect</Name>' <<<"$body" | cut -d: -f1)
  inj_line=$(grep -n '<Name>AM-Superdemo-Target-Pool-Error</Name>' <<<"$body" | cut -d: -f1)

  # Correctly placed, the injected <Step>/<Name>/</Step> block starts on the
  # very next line after the single-line DC-Collect step, so the injected
  # <Name> lands 2 lines later. If it instead landed after the unrelated
  # PreFlow step's </Step>, inj_line would be many lines further down.
  if (( inj_line - dc_line != 2 )); then
    echo "FAIL:   injected step not placed immediately after single-line DC-Collect (dc_line=$dc_line inj_line=$inj_line)"
    exit 1
  fi
  # And it must land inside the FaultRule, before the unrelated PreFlow step.
  preflow_line=$(grep -n '<PreFlow name="PreFlow">' <<<"$body" | cut -d: -f1)
  if (( inj_line >= preflow_line )); then
    echo "FAIL:   injected step leaked past the FaultRule into the PreFlow (inj_line=$inj_line preflow_line=$preflow_line)"
    exit 1
  fi
  echo "PASS:   single-line DC-Collect step patched in place, not attached to a later unrelated </Step>"
) || fail=1

echo
echo "patch_circuit_breaking_bundle: fails when only ONE of the two files has an anchor (per-file guard)"
(
  sibling_dir=$(mktemp -d /tmp/superdemo-sibling.XXXXXX)
  mkdir -p "$sibling_dir/apiproxy/policies" \
           "$sibling_dir/apiproxy/proxies" \
           "$sibling_dir/apiproxy/targets"

  # default.xml: TWO DC-Collect anchors (simulates the sum-based guard being
  # fooled by both anchors landing in the same file).
  cat > "$sibling_dir/apiproxy/proxies/default.xml" <<'XML'
<ProxyEndpoint name="default">
  <PostFlow name="PostFlow">
    <Response>
      <Step>
        <Name>DC-Collect</Name>
      </Step>
      <Step>
        <Name>DC-Collect</Name>
      </Step>
    </Response>
  </PostFlow>
</ProxyEndpoint>
XML

  # primary.xml: NO DC-Collect anchor at all — the retry path would ship unpatched.
  cat > "$sibling_dir/apiproxy/targets/primary.xml" <<'XML'
<TargetEndpoint name="primary">
  <FaultRules>
    <FaultRule name="LLMQuota">
      <Step>
        <Name>Q-LLM-Failover-Counter</Name>
      </Step>
    </FaultRule>
  </FaultRules>
</TargetEndpoint>
XML

  export PROJECT="test-project"
  export REGION="us-central1"
  export SECONDARY_REGION="us-east4"

  out=$(patch_circuit_breaking_bundle "$sibling_dir" 2>/tmp/superdemo-patch-stderr.$$)
  rc=$?
  stderr=$(cat "/tmp/superdemo-patch-stderr.$$")
  rm -f "/tmp/superdemo-patch-stderr.$$"
  rm -rf "$sibling_dir"

  if (( rc == 0 )); then
    echo "FAIL:   expected non-zero return when one file has 0 anchors (sum-based guard passed with total=2)"
    [[ -n "$out" ]] && rm -rf "$out"
    exit 1
  fi
  if [[ -n "$out" ]]; then
    echo "FAIL:   expected nothing on stdout, got '$out'"
    exit 1
  fi
  if [[ "$stderr" != *"primary.xml"* ]]; then
    echo "FAIL:   expected stderr to name the offending file (primary.xml), got: $stderr"
    exit 1
  fi
  echo "PASS:   per-file guard fails loudly naming the unpatched file, even though total insertions >= 2"
) || fail=1

echo
echo "patch_circuit_breaking_bundle: fault path gets the -Error variant, response path does not"
(
  # The bug this pins: a FaultRule returns the `error` message, not `response`.
  # Injecting the plain (response-targeting) policy on the retry path sets the
  # headers on a message nobody sends, so the browser sees no x-target-pool and
  # the UI shows "unknown" for every failing request.
  sibling_dir=$(mktemp -d /tmp/superdemo-sibling.XXXXXX)
  mkdir -p "$sibling_dir/apiproxy/policies" \
           "$sibling_dir/apiproxy/proxies" \
           "$sibling_dir/apiproxy/targets"

  cat > "$sibling_dir/apiproxy/proxies/default.xml" <<'XML'
<ProxyEndpoint name="default">
  <PostFlow name="PostFlow">
    <Response>
      <Step>
        <Name>DC-Collect</Name>
      </Step>
    </Response>
  </PostFlow>
</ProxyEndpoint>
XML

  cat > "$sibling_dir/apiproxy/targets/primary.xml" <<'XML'
<TargetEndpoint name="primary">
  <FaultRules>
    <FaultRule name="LLMQuota">
      <Step>
        <Name>DC-Collect</Name>
      </Step>
    </FaultRule>
  </FaultRules>
</TargetEndpoint>
XML

  export PROJECT="test-project"
  export REGION="us-central1"
  export SECONDARY_REGION="us-east4"

  work_dir=$(patch_circuit_breaking_bundle "$sibling_dir")
  rc=$?
  rm -rf "$sibling_dir"

  if (( rc != 0 )) || [[ -z "$work_dir" ]]; then
    echo "FAIL:   patch_circuit_breaking_bundle returned $rc"
    exit 1
  fi

  proxy_xml=$(cat "$work_dir/apiproxy/proxies/default.xml")
  target_xml=$(cat "$work_dir/apiproxy/targets/primary.xml")
  err_policy=$(cat "$work_dir/apiproxy/policies/AM-Superdemo-Target-Pool-Error.xml" 2>/dev/null || true)

  # The FaultRule anchor must get the -Error variant...
  if ! grep -q '<Name>AM-Superdemo-Target-Pool-Error</Name>' <<<"$target_xml"; then
    echo "FAIL:   primary.xml's FaultRule did not get the -Error variant"
    rm -rf "$work_dir"
    exit 1
  fi
  # ...and the response-flow anchor must NOT (it would write to the wrong message).
  if grep -q '<Name>AM-Superdemo-Target-Pool-Error</Name>' <<<"$proxy_xml"; then
    echo "FAIL:   default.xml's response PostFlow got the -Error variant"
    rm -rf "$work_dir"
    exit 1
  fi
  if ! grep -q '<Name>AM-Superdemo-Target-Pool</Name>' <<<"$proxy_xml"; then
    echo "FAIL:   default.xml did not get the response-flow variant"
    rm -rf "$work_dir"
    exit 1
  fi
  # And the -Error policy must actually target the `error` message. Without this,
  # the variant is just a rename and the headers still go nowhere.
  if ! grep -q '<AssignTo[^>]*>error</AssignTo>' <<<"$err_policy"; then
    echo "FAIL:   AM-Superdemo-Target-Pool-Error does not AssignTo the 'error' message"
    rm -rf "$work_dir"
    exit 1
  fi

  rm -rf "$work_dir"
  echo "PASS:   fault path patched with the error-targeting policy, response path with the plain one"
) || fail=1

echo
echo "ai_product_set_model / ai_product_all_models_are: rebind an AI product's model"
(
  # Shape mirrors a real GET on ai-product-bronze-v2, trimmed to what we touch.
  ai_product_json='{
    "name": "ai-product-bronze-v2",
    "createdAt": "1779913831455",
    "lastModifiedAt": "1779913831455",
    "llmOperationGroup": {
      "operationConfigs": [
        {
          "apiSource": "llm-token-limits-v2",
          "llmOperations": [
            { "resource": "/", "methods": ["POST"], "model": "gemini-2.5-flash" }
          ],
          "llmTokenQuota": { "limit": "2000", "interval": "5", "timeUnit": "minute" }
        }
      ]
    }
  }'
  patched=$(ai_product_set_model "$ai_product_json" "gemini-2.5-flash-lite")

  assert_equal "gemini-2.5-flash-lite" \
    "$(jq -r '.llmOperationGroup.operationConfigs[0].llmOperations[0].model' <<<"$patched")" \
    "  rewrites llmOperations[].model"
  assert_equal "2000" \
    "$(jq -r '.llmOperationGroup.operationConfigs[0].llmTokenQuota.limit' <<<"$patched")" \
    "  leaves the token quota intact"
  assert_equal "null" "$(jq -r '.createdAt' <<<"$patched")" \
    "  strips server-owned createdAt so the result can be PUT back"

  if ai_product_all_models_are "$patched" "gemini-2.5-flash-lite"; then
    echo "PASS:   all-models predicate accepts a fully-rebound product"
  else
    echo "FAIL:   all-models predicate rejected a fully-rebound product"
    fail=1
  fi
  if ai_product_all_models_are "$ai_product_json" "gemini-2.5-flash-lite"; then
    echo "FAIL:   all-models predicate accepted a product still on the old model"
    fail=1
  else
    echo "PASS:   all-models predicate rejects a product still on the old model"
  fi

  # An Apigee error body has no llmOperations. It must NOT vacuously pass, or a failed
  # update would be reported as a successful patch.
  if ai_product_all_models_are '{"error":{"message":"permission denied"}}' "gemini-2.5-flash-lite"; then
    echo "FAIL:   all-models predicate vacuously accepted an API error body"
    fail=1
  else
    echo "PASS:   all-models predicate rejects an API error body (no operations)"
  fi

  # A non-AI product (plain operationGroup) must fail loudly rather than be "patched".
  if ai_product_set_model '{"name":"p","operationGroup":{"operationConfigs":[]}}' "m" >/dev/null 2>&1; then
    echo "FAIL:   expected non-zero return when the product has no llmOperationGroup"
    fail=1
  else
    echo "PASS:   fails loudly on a non-AI product (no llmOperationGroup)"
  fi
  exit $fail
) || fail=1

echo
echo "is_semantic_cache_index_ready: true only when the endpoint has the deployed index"
(
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  # Ready: endpoint exists AND has the deployed index id.
  cat > "$stub_dir/gcloud" <<'STUB'
#!/bin/bash
cat <<'JSON'
[
  {
    "displayName": "semantic-cache-index-endpoint",
    "deployedIndexes": [ { "id": "semantic_cache_index_endpoint_deployment" } ]
  }
]
JSON
STUB
  chmod +x "$stub_dir/gcloud"
  export PATH="$stub_dir:$PATH"

  if is_semantic_cache_index_ready "proj" "us-east1"; then
    echo "PASS:   ready when deployed index present"
  else
    echo "FAIL:   expected ready"
    rm -rf "$stub_dir"; exit 1
  fi

  # Not ready: endpoint exists but no deployed index yet.
  cat > "$stub_dir/gcloud" <<'STUB'
#!/bin/bash
cat <<'JSON'
[ { "displayName": "semantic-cache-index-endpoint" } ]
JSON
STUB
  chmod +x "$stub_dir/gcloud"
  if is_semantic_cache_index_ready "proj" "us-east1"; then
    echo "FAIL:   expected not-ready when no deployed index"
    rm -rf "$stub_dir"; exit 1
  else
    echo "PASS:   not ready when endpoint has no deployed index"
  fi

  # Not ready: no matching endpoint at all.
  cat > "$stub_dir/gcloud" <<'STUB'
#!/bin/bash
echo '[]'
STUB
  chmod +x "$stub_dir/gcloud"
  if is_semantic_cache_index_ready "proj" "us-east1"; then
    echo "FAIL:   expected not-ready when endpoint absent"
    rm -rf "$stub_dir"; exit 1
  else
    echo "PASS:   not ready when endpoint absent"
  fi
  rm -rf "$stub_dir"
) || fail=1

if (( fail != 0 )); then
  echo
  echo "FAIL: some tests failed"
  exit 1
fi
echo
echo "OK: all tests passed"
