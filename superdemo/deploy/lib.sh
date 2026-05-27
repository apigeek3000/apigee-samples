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
# Runs curl with the supplied method, URL and extra args, discarding the body
# and echoing only the HTTP status code to stdout.
# Returns 0 if curl itself succeeded (network reachable, TLS OK), 1 otherwise.
# Caller decides pass/fail by inspecting the echoed code.
smoke_test_proxy() {
  local label method url code curl_status
  label="$1"
  method="$2"
  url="$3"
  shift 3

  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -X "$method" "$url" "$@" --max-time 30)
  curl_status=$?

  echo "$code"
  return $curl_status
}
