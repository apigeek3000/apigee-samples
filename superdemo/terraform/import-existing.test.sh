#!/bin/bash
# Tests for superdemo/terraform/import-existing.sh helpers.
# Run with: bash superdemo/terraform/import-existing.test.sh

set -euo pipefail

scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
source "$scriptdir/import-existing.sh"

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

# assert_status <expected_rc> <label> <cmd...>
assert_status() {
  local expected="$1" label="$2" rc
  shift 2
  "$@" && rc=0 || rc=$?
  assert_equal "$expected" "$rc" "$label"
}

echo "in_list: exact whole-line match only"
list=$'google_service_account.app\ngoogle_project_iam_member.app["roles/aiplatform.user"]'
assert_status 0 "  exact address → found" in_list 'google_project_iam_member.app["roles/aiplatform.user"]' "$list"
assert_status 1 "  prefix only → not found" in_list 'google_service_account.ap' "$list"
assert_status 1 "  empty list → not found" in_list 'google_service_account.app' ""

echo
echo "sa_email: builds the service account email"
assert_equal "app@proj.iam.gserviceaccount.com" "$(sa_email app proj)" "  account id + project"

echo
echo "policy_has_member: unconditional binding for role lists member"
policy='{"bindings":[
  {"role":"roles/run.invoker","members":["serviceAccount:a@p.iam.gserviceaccount.com"]},
  {"role":"roles/logging.viewer","members":["serviceAccount:b@p.iam.gserviceaccount.com"],
   "condition":{"title":"t","expression":"true"}}
]}'
assert_status 0 "  member in role → true" policy_has_member "$policy" roles/run.invoker serviceAccount:a@p.iam.gserviceaccount.com
assert_status 1 "  other role → false" policy_has_member "$policy" roles/apihub.admin serviceAccount:a@p.iam.gserviceaccount.com
assert_status 1 "  conditional binding → false" policy_has_member "$policy" roles/logging.viewer serviceAccount:b@p.iam.gserviceaccount.com
assert_status 1 "  empty policy → false" policy_has_member "" roles/run.invoker serviceAccount:a@p.iam.gserviceaccount.com

echo
echo "vertex_id_by_display_name: trailing id of the first match"
indexes='[
  {"displayName":"other","name":"projects/123/locations/us-central1/indexes/111"},
  {"displayName":"semantic-cache-index","name":"projects/123/locations/us-central1/indexes/222"}
]'
assert_equal "222" "$(vertex_id_by_display_name "$indexes" semantic-cache-index)" "  match → id"
assert_equal "" "$(vertex_id_by_display_name "$indexes" missing)" "  no match → empty"
assert_equal "" "$(vertex_id_by_display_name "" semantic-cache-index)" "  empty input → empty"

echo
echo "endpoint_has_deployed_index: endpoint by name carries the deployed index id"
endpoints='[{"displayName":"semantic-cache-index-endpoint",
  "deployedIndexes":[{"id":"semantic_cache_index_endpoint_deployment"}]}]'
assert_status 0 "  deployed → true" endpoint_has_deployed_index "$endpoints" semantic-cache-index-endpoint semantic_cache_index_endpoint_deployment
assert_status 1 "  no deployedIndexes → false" endpoint_has_deployed_index '[{"displayName":"semantic-cache-index-endpoint"}]' semantic-cache-index-endpoint semantic_cache_index_endpoint_deployment
assert_status 1 "  other endpoint → false" endpoint_has_deployed_index "$endpoints" other semantic_cache_index_endpoint_deployment

echo
echo "try_import: skips in-state and missing; imports the rest; records failures"
(
  stub_dir=$(mktemp -d /tmp/superdemo-stub.XXXXXX)
  export STUB_DIR="$stub_dir"
  cat > "$stub_dir/terraform" <<'STUB'
#!/bin/bash
# args: -chdir=<dir> import -input=false <address> <id>
echo "$4 $5" >> "$STUB_DIR/imports"
[[ "$4" == "bad.addr" ]] && exit 1
exit 0
STUB
  chmod +x "$stub_dir/terraform"
  export PATH="$stub_dir:$PATH"

  state_list="in.state"
  try_import in.state id0 true >/dev/null
  try_import not.found id1 false >/dev/null
  try_import good.addr id2 true >/dev/null
  try_import bad.addr id3 true >/dev/null

  assert_equal "1" "$n_in_state" "  in state → counted, not imported"
  assert_equal "1" "$n_missing" "  check fails → counted as missing"
  assert_equal "1" "$n_imported" "  exists → imported"
  assert_equal "  bad.addr" "${failed_list%$'\n'}" "  import fails → recorded"
  assert_equal $'good.addr id2\nbad.addr id3' "$(cat "$stub_dir/imports")" "  terraform import ran only for existing, not-in-state"

  rm -rf "$stub_dir"
  (( fail == 0 ))
) || fail=1

if (( fail )); then
  echo
  echo "FAIL: some tests failed"
  exit 1
fi
echo
echo "OK: all tests passed"
