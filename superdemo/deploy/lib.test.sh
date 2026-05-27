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
  # Subshell isolates the exported vars from anything below.
  export APIGEE_HOST="apigee.test.example.com"
  export PROJECT_ID="test-project"
  export BASIC_QUOTA_TRIAL_KEY="trial-key-123"
  export BASIC_QUOTA_PREMIUM_KEY="premium-key-456"
  export BASIC_QUOTA_STATUS="passing"
  export LLM_SECURITY_KEY="llm-key-789"
  export MODEL_NAME="gemini-fake"
  export MODEL_ARMOR_REGION="us-central1"
  export LLM_SECURITY_STATUS="failing"

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
    }
  }
}
JSON
)

  if [[ "$actual" == "$expected" ]]; then
    echo "PASS:   demos.{basic-quota,llm-security} populated from 9 globals"
  else
    echo "FAIL:   demos.{basic-quota,llm-security} populated from 9 globals — diff:"
    diff <(echo "$expected") <(echo "$actual") || true
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
