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
    }
  }
}
JSON
)

  if [[ "$actual" == "$expected" ]]; then
    echo "PASS:   demos.{basic-quota,llm-security,llm-token-limits-v2,apigee-mcp,cloud-logging,threat-protection} populated"
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

if (( fail != 0 )); then
  echo
  echo "FAIL: some tests failed"
  exit 1
fi
echo
echo "OK: all tests passed"
