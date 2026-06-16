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

import copy
import gzip
import json
import os
import re
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import google.auth.exceptions
from fastapi.testclient import TestClient

# Ensure no project is set during testing so the config falls back gracefully
os.environ.pop("GOOGLE_CLOUD_PROJECT", None)

# Force ADC discovery to fail so tests don't depend on the developer's gcloud state.
_adc_patch = patch(
    "google.auth.default",
    side_effect=google.auth.exceptions.DefaultCredentialsError("disabled in tests"),
)
_adc_patch.start()

from main import app  # noqa: E402

client = TestClient(app)

import pytest  # noqa: E402
import respx  # noqa: E402

import main  # noqa: E402

FAKE_HOST = "apigee.test.example.com"
FAKE_CONFIG = {
    "APIGEE_HOST": FAKE_HOST,
    "PROJECT_ID": "fake-project",
    "demos": {
        "basic-quota": {
            "trial_key": "trial-key-123",
            "premium_key": "premium-key-456",
            "status": "passing",
        },
        "llm-security": {
            "key": "llm-key-789",
            "model_name": "gemini-fake",
            "model_armor_region": "us-central1",
            "status": "passing",
        },
        "llm-token-limits-v2": {
            "bronze_key": "bronze-key-001",
            "silver_key": "silver-key-002",
            "status": "passing",
            "bronze_token_limit": 2000,
            "silver_token_limit": 5000,
            "interval_minutes": 5,
            "model": "gemini-fake",
            "region": "us-central1",
        },
        "apigee-mcp": {
            "mcp_endpoint": "https://apigee.test.example.com/crm-mcp-proxy/sse",
            "client_id": "fake-client-id",
            "client_secret": "fake-client-secret",
            "model": "gemini-fake",
            "region": "us-central1",
            "status": "passing",
        },
    },
}


@pytest.fixture
def fake_config():
    """Seed main._config_cache so get_config() short-circuits and skips Secret Manager."""
    main._config_cache = copy.deepcopy(FAKE_CONFIG)
    try:
        yield main._config_cache
    finally:
        main._config_cache = None


@pytest.fixture
def fake_bearer_token(monkeypatch):
    """Replace _get_bearer_token so tests don't need real ADC credentials."""
    token = "fake-bearer-token"
    monkeypatch.setattr(main, "_get_bearer_token", lambda: token)
    yield token


def test_list_demos_unconfigured():
    """Without GOOGLE_CLOUD_PROJECT the backend reports unconfigured and all real demos get status=unknown."""
    response = client.get("/api/demos")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unconfigured"
    assert len(data["demos"]) == 12
    for demo in data["demos"]:
        if demo.get("placeholder"):
            continue
        assert demo["status"] == "unknown"


def test_list_demos_returns_metadata():
    """Check that demo metadata is always present."""
    response = client.get("/api/demos")
    data = response.json()
    ids = [d["id"] for d in data["demos"]]
    assert "basic-quota" in ids
    assert "llm-security" in ids
    assert "llm-token-limits-v2" in ids


def test_proxy_unknown_demo():
    """Requesting a non-existent demo should 500 (config unavailable) or 404."""
    response = client.get("/api/proxy/nonexistent/test")
    # Without config, it will raise 500 before hitting the 404 check
    assert response.status_code in (404, 500)


def test_proxy_basic_quota_trial_injects_query_param_key(fake_config):
    """Default tier 'trial' calls Apigee with the trial key as ?apikey=..."""
    target_url = f"https://{FAKE_HOST}/v1/samples/basic-quota"
    with respx.mock(assert_all_called=True) as mock:
        # respx 0.21.1 + httpcore mocker delivers bytes method (b'GET'), so method-
        # based shortcuts (mock.get) never match.  Use url__startswith instead.
        route = mock.route(url__startswith=target_url).respond(
            200, json={"message": "ok", "allowed": "10", "used": "1"}
        )
        response = client.get("/api/proxy/basic-quota/")

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.url.params["apikey"] == "trial-key-123"


def test_proxy_basic_quota_premium_uses_premium_key(fake_config):
    """x-quota-tier: premium selects the premium_key from the nested config."""
    target_url = f"https://{FAKE_HOST}/v1/samples/basic-quota"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"message": "ok"})
        response = client.get(
            "/api/proxy/basic-quota/",
            headers={"x-quota-tier": "premium"},
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.url.params["apikey"] == "premium-key-456"


def test_proxy_llm_security_injects_x_apikey_header(fake_config):
    """POST to /api/proxy/llm-security/<path> forwards body and injects x-apikey."""
    sub_path = "v1/projects/fake/locations/us-central1/publishers/google/models/gemini:generateContent"
    target_url = f"https://{FAKE_HOST}/v2/samples/llm-security/{sub_path}"
    request_body = {"contents": [{"role": "user", "parts": [{"text": "hi"}]}]}

    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(
            200, json={"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}
        )
        response = client.post(
            f"/api/proxy/llm-security/{sub_path}",
            json=request_body,
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.headers["x-apikey"] == "llm-key-789"
    assert json.loads(captured.content) == request_body


def test_proxy_forwards_status_and_body(fake_config):
    """Upstream 429 + body is forwarded to the client unchanged."""
    target_url = f"https://{FAKE_HOST}/v1/samples/basic-quota"
    upstream_body = {"fault": {"faultstring": "Rate limit quota violation"}}
    with respx.mock(assert_all_called=True) as mock:
        mock.route(url__startswith=target_url).respond(429, json=upstream_body)
        response = client.get("/api/proxy/basic-quota/")

    assert response.status_code == 429
    assert response.json() == upstream_body


def test_proxy_strips_hop_by_hop_response_headers(fake_config):
    """transfer-encoding and content-encoding from upstream are not forwarded."""
    target_url = f"https://{FAKE_HOST}/v1/samples/basic-quota"
    raw_body = b'{"ok":true}'
    compressed_body = gzip.compress(raw_body)
    with respx.mock(assert_all_called=True) as mock:
        # Provide a genuinely gzip-compressed body so respx can decode it;
        # the proxy must then strip the hop-by-hop headers before forwarding.
        mock.route(url__startswith=target_url).respond(
            200,
            content=compressed_body,
            headers={
                "transfer-encoding": "chunked",
                "content-encoding": "gzip",
                "content-type": "application/json",
                "x-custom": "keep-me",
            },
        )
        response = client.get("/api/proxy/basic-quota/")

    # Dropped
    assert "transfer-encoding" not in {k.lower() for k in response.headers}
    assert "content-encoding" not in {k.lower() for k in response.headers}
    # Custom header preserved
    assert response.headers.get("x-custom") == "keep-me"


def test_proxy_missing_api_key_returns_500(fake_config):
    """Config present but trial_key missing → 500 with documented detail."""
    del fake_config["demos"]["basic-quota"]["trial_key"]
    # No respx mock — request should fail before any outbound call
    response = client.get("/api/proxy/basic-quota/")

    assert response.status_code == 500
    assert response.json()["detail"] == "API key not found for basic-quota"


def test_list_demos_includes_status(fake_config):
    response = client.get("/api/demos")
    assert response.status_code == 200
    data = response.json()
    statuses = {
        d["id"]: d["status"]
        for d in data["demos"]
        if not d.get("placeholder")
    }
    assert statuses == {
        "basic-quota": "passing",
        "llm-security": "passing",
        "llm-token-limits-v2": "passing",
        "apigee-mcp": "passing",
        "cloud-logging": "unknown",
        "threat-protection": "unknown",
    }


def test_list_demos_missing_demos_block(fake_config):
    """No `demos` key in the config → all real demos report status=unknown."""
    del fake_config["demos"]
    response = client.get("/api/demos")
    data = response.json()
    for demo in data["demos"]:
        if demo.get("placeholder"):
            continue
        assert demo["status"] == "unknown"


def test_list_demos_partial_demos_block(fake_config):
    """Demo missing from `demos` map → that demo reports status=unknown."""
    del fake_config["demos"]["llm-security"]
    response = client.get("/api/demos")
    data = response.json()
    statuses = {d["id"]: d["status"] for d in data["demos"]}
    assert statuses["basic-quota"] == "passing"
    assert statuses["llm-security"] == "unknown"


def test_list_demos_unrecognized_status_passes_through(fake_config):
    """Backend is a faithful mirror; normalization happens frontend-side."""
    fake_config["demos"]["basic-quota"]["status"] = "weird"
    response = client.get("/api/demos")
    data = response.json()
    bq = next(d for d in data["demos"] if d["id"] == "basic-quota")
    assert bq["status"] == "weird"



def test_list_demos_llm_security_includes_model_info(fake_config):
    response = client.get("/api/demos")
    data = response.json()
    llm = next(d for d in data["demos"] if d["id"] == "llm-security")
    assert llm["model_name"] == "gemini-fake"
    assert llm["model_armor_region"] == "us-central1"


def test_list_demos_llm_token_limits_includes_config_fields(fake_config):
    response = client.get("/api/demos")
    data = response.json()
    ltl = next(d for d in data["demos"] if d["id"] == "llm-token-limits-v2")
    assert ltl["bronze_token_limit"] == 2000
    assert ltl["silver_token_limit"] == 5000
    assert ltl["interval_minutes"] == 5
    assert ltl["model"] == "gemini-fake"
    assert ltl["region"] == "us-central1"


def test_list_demos_does_not_expose_model_fields_at_top_level(fake_config):
    response = client.get("/api/demos")
    data = response.json()
    assert "model_name" not in data
    assert "model_armor_region" not in data


def test_proxy_llm_token_limits_bronze_uses_bronze_key(fake_config, fake_bearer_token):
    """Default tier 'bronze' injects the bronze key as x-apikey and forwards to the
    correct base path."""
    sub_path = "v1/projects/fake/locations/us-central1/publishers/google/models/gemini-fake:generateContent"
    target_url = f"https://{FAKE_HOST}/v2/samples/llm-token-limits/{sub_path}"
    request_body = {
        "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
    }

    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": "hello"}]}}],
                "usageMetadata": {
                    "promptTokenCount": 5,
                    "candidatesTokenCount": 3,
                    "totalTokenCount": 8,
                },
            },
        )
        response = client.post(
            f"/api/proxy/llm-token-limits-v2/{sub_path}",
            json=request_body,
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.headers["x-apikey"] == "bronze-key-001"
    assert json.loads(captured.content) == request_body


def test_proxy_llm_token_limits_silver_uses_silver_key(fake_config, fake_bearer_token):
    """x-rate-limit-tier: silver selects the silver_key."""
    sub_path = "v1/projects/fake/locations/us-central1/publishers/google/models/gemini-fake:generateContent"
    target_url = f"https://{FAKE_HOST}/v2/samples/llm-token-limits/{sub_path}"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"ok": True})
        response = client.post(
            f"/api/proxy/llm-token-limits-v2/{sub_path}",
            json={"contents": []},
            headers={"x-rate-limit-tier": "silver"},
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.headers["x-apikey"] == "silver-key-002"


def test_proxy_llm_token_limits_missing_key_returns_500(fake_config):
    """Config present but bronze_key missing → 500 with documented detail."""
    del fake_config["demos"]["llm-token-limits-v2"]["bronze_key"]
    response = client.post(
        "/api/proxy/llm-token-limits-v2/v1/projects/fake/locations/us-central1/publishers/google/models/gemini-fake:generateContent",
        json={"contents": []},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "API key not found for llm-token-limits-v2"


def test_proxy_llm_token_limits_unknown_tier_defaults_to_bronze(fake_config, fake_bearer_token):
    """Unknown tier header value falls back to bronze."""
    sub_path = "v1/projects/fake/locations/us-central1/publishers/google/models/gemini-fake:generateContent"
    target_url = f"https://{FAKE_HOST}/v2/samples/llm-token-limits/{sub_path}"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"ok": True})
        response = client.post(
            f"/api/proxy/llm-token-limits-v2/{sub_path}",
            json={"contents": []},
            headers={"x-rate-limit-tier": "platinum"},
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.headers["x-apikey"] == "bronze-key-001"


def test_proxy_llm_token_limits_attaches_bearer_token(fake_config, fake_bearer_token):
    """llm-token-limits-v2 must attach Authorization: Bearer <ADC token> so the
    upstream Vertex call succeeds. The sibling proxy has no <GoogleAccessToken>
    block, so the caller (us) is responsible for the OAuth token."""
    sub_path = "v1/projects/fake/locations/us-central1/publishers/google/models/gemini-fake:generateContent"
    target_url = f"https://{FAKE_HOST}/v2/samples/llm-token-limits/{sub_path}"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"ok": True})
        response = client.post(
            f"/api/proxy/llm-token-limits-v2/{sub_path}",
            json={"contents": []},
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.headers["authorization"] == f"Bearer {fake_bearer_token}"


def test_proxy_llm_security_does_not_attach_bearer_token(fake_config):
    """llm-security has <GoogleAccessToken> in its proxy target XML, so Apigee
    mints the token itself. We must NOT attach our own Authorization header."""
    sub_path = "v1/projects/fake/locations/us-central1/publishers/google/models/gemini:generateContent"
    target_url = f"https://{FAKE_HOST}/v2/samples/llm-security/{sub_path}"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"ok": True})
        response = client.post(f"/api/proxy/llm-security/{sub_path}", json={})

    assert response.status_code == 200
    captured = route.calls.last.request
    assert "authorization" not in {k.lower() for k in captured.headers.keys()}


def test_proxy_basic_quota_does_not_attach_bearer_token(fake_config):
    """basic-quota is a plain Apigee quota demo; no Vertex call, no bearer token."""
    target_url = f"https://{FAKE_HOST}/v1/samples/basic-quota"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"ok": True})
        response = client.get("/api/proxy/basic-quota/")

    assert response.status_code == 200
    captured = route.calls.last.request
    assert "authorization" not in {k.lower() for k in captured.headers.keys()}


def test_proxy_does_not_forward_caller_authorization(fake_config):
    """The caller's Authorization (browser Firebase ID token) must never be
    forwarded upstream — the backend injects its own per-demo credentials."""
    target_url = f"https://{FAKE_HOST}/v1/samples/basic-quota"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"ok": True})
        response = client.get(
            "/api/proxy/basic-quota/",
            headers={"Authorization": "Bearer caller-id-token"},
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert "authorization" not in {k.lower() for k in captured.headers.keys()}


def test_proxy_llm_token_limits_missing_adc_returns_500(fake_config, monkeypatch):
    """If ADC isn't configured, surface a 500 with an actionable message rather
    than letting the DefaultCredentialsError bubble up unhandled."""
    def _raise():
        raise google.auth.exceptions.DefaultCredentialsError("no creds")
    monkeypatch.setattr(main, "_get_bearer_token", _raise)

    response = client.post(
        "/api/proxy/llm-token-limits-v2/v1/projects/fake/locations/us-central1/publishers/google/models/gemini-fake:generateContent",
        json={"contents": []},
    )

    assert response.status_code == 500
    assert "gcloud auth application-default login" in response.json()["detail"]


PLACEHOLDER_DEMO_IDS = {
    "llm-semantic-cache-v2",
    "llm-routing",
    "llm-circuit-breaking",
    "llm-logging",
    "llm-token-limits-per-user",
    "llm-function-calling",
}


def test_list_demos_includes_six_placeholder_demos():
    """All six placeholder demos appear with status=placeholder and placeholder=True."""
    response = client.get("/api/demos")
    data = response.json()
    by_id = {d["id"]: d for d in data["demos"]}

    for pid in PLACEHOLDER_DEMO_IDS:
        assert pid in by_id, f"missing placeholder demo: {pid}"
        assert by_id[pid]["status"] == "placeholder"
        assert by_id[pid]["placeholder"] is True


def test_placeholder_status_overrides_stale_secret(fake_config):
    """Even if the secret has stale data for a placeholder id, status stays 'placeholder'."""
    fake_config["demos"]["llm-routing"] = {"status": "passing", "key": "stale-key"}
    response = client.get("/api/demos")
    data = response.json()
    routing = next(d for d in data["demos"] if d["id"] == "llm-routing")
    assert routing["status"] == "placeholder"
    assert routing["placeholder"] is True


def test_real_demos_are_not_marked_as_placeholder():
    """The three real demos must not carry placeholder=True."""
    response = client.get("/api/demos")
    data = response.json()
    real_ids = {"basic-quota", "llm-security", "llm-token-limits-v2"}
    for demo in data["demos"]:
        if demo["id"] in real_ids:
            assert demo.get("placeholder") is not True


def test_list_demos_includes_apigee_mcp():
    """The /api/demos payload includes the apigee-mcp entry with all surfaced fields."""
    main._config_cache = {
        "APIGEE_HOST": FAKE_HOST,
        "PROJECT_ID": "fake-project",
        "demos": {
            "apigee-mcp": {
                "mcp_endpoint": "https://apigee.test.example.com/crm-mcp-proxy/sse",
                "client_id": "k",
                "client_secret": "s",
                "model": "gemini-fake",
                "region": "us-east1",
                "status": "passing",
            },
        },
    }
    try:
        response = client.get("/api/demos")
        assert response.status_code == 200
        mcp = next(d for d in response.json()["demos"] if d["id"] == "apigee-mcp")
        assert mcp["title"] == "MCP Server"
        assert mcp["status"] == "passing"
        assert mcp["mcp_endpoint"] == "https://apigee.test.example.com/crm-mcp-proxy/sse"
        assert mcp["model"] == "gemini-fake"
        assert mcp["region"] == "us-east1"
        # client_id and client_secret must NOT be surfaced to the browser
        assert "client_id" not in mcp
        assert "client_secret" not in mcp
    finally:
        main._config_cache = None


def test_list_demos_includes_cloud_logging_and_threat_protection():
    """Both new demos appear in /api/demos and are NOT marked placeholder."""
    response = client.get("/api/demos")
    data = response.json()
    by_id = {d["id"]: d for d in data["demos"]}

    assert "cloud-logging" in by_id
    assert by_id["cloud-logging"].get("placeholder") is None
    assert by_id["cloud-logging"]["title"] == "Cloud Logging"
    assert by_id["cloud-logging"]["icon"] == "🪵"

    assert "threat-protection" in by_id
    assert by_id["threat-protection"].get("placeholder") is None
    assert by_id["threat-protection"]["title"] == "Threat Protection"
    assert by_id["threat-protection"]["icon"] == "🧱"


def test_list_demos_cloud_logging_enrichment(fake_config):
    """cloud-logging picks up log_name and proxy_name from the secret config."""
    fake_config["demos"]["cloud-logging"] = {
        "status": "passing",
        "log_name": "projects/fake-project/logs/apigee",
        "proxy_name": "sample-cloud-logging",
    }
    response = client.get("/api/demos")
    data = response.json()
    cl = next(d for d in data["demos"] if d["id"] == "cloud-logging")
    assert cl["status"] == "passing"
    assert cl["log_name"] == "projects/fake-project/logs/apigee"
    assert cl["proxy_name"] == "sample-cloud-logging"


def test_list_demos_threat_protection_enrichment(fake_config):
    """threat-protection picks up max_json_object_keys and blocked_keywords."""
    fake_config["demos"]["threat-protection"] = {
        "status": "passing",
        "max_json_object_keys": 5,
        "blocked_keywords": ["delete", "exec", "drop table"],
    }
    response = client.get("/api/demos")
    data = response.json()
    tp = next(d for d in data["demos"] if d["id"] == "threat-protection")
    assert tp["status"] == "passing"
    assert tp["max_json_object_keys"] == 5
    assert tp["blocked_keywords"] == ["delete", "exec", "drop table"]


def test_proxy_cloud_logging_forwards_get_without_api_key(fake_config):
    """GET /api/proxy/cloud-logging/ forwards to the cloud-logging proxy with no x-apikey."""
    target_url = f"https://{FAKE_HOST}/v1/samples/cloud-logging"
    upstream_body = {"args": {}, "headers": {"Host": "httpbin.org"}, "url": "https://httpbin.org/get"}
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json=upstream_body)
        response = client.get("/api/proxy/cloud-logging/")

    assert response.status_code == 200
    assert response.json() == upstream_body
    captured = route.calls.last.request
    # No API key should be injected (neither header nor query param).
    assert "x-apikey" not in {k.lower() for k in captured.headers}
    assert "apikey" not in captured.url.params


def test_proxy_threat_protection_regex_allowed(fake_config):
    """GET /api/proxy/threat-protection/json?query=select forwards 200 from upstream."""
    target_url = f"https://{FAKE_HOST}/v1/samples/threat-protection/json"
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(
            200, json={"args": {"query": "select"}}
        )
        response = client.get("/api/proxy/threat-protection/json?query=select")

    assert response.status_code == 200
    captured = route.calls.last.request
    assert captured.url.params["query"] == "select"
    assert "x-apikey" not in {k.lower() for k in captured.headers}


def test_proxy_threat_protection_regex_blocked(fake_config):
    """Upstream 500 (Apigee RegEx fault) is forwarded with body intact."""
    target_url = f"https://{FAKE_HOST}/v1/samples/threat-protection/json"
    fault_body = {"fault": {"faultstring": "Regular Expression Threat Detected", "detail": {"errorcode": "steps.regularexpressionprotection.ExecutionFailed"}}}
    with respx.mock(assert_all_called=True) as mock:
        mock.route(url__startswith=target_url).respond(500, json=fault_body)
        response = client.get("/api/proxy/threat-protection/json?query=delete")

    assert response.status_code == 500
    assert response.json() == fault_body


def test_proxy_threat_protection_json_allowed(fake_config):
    """POST /api/proxy/threat-protection/echo with a 5-key body returns 200."""
    target_url = f"https://{FAKE_HOST}/v1/samples/threat-protection/echo"
    payload = {"f1": "t1", "f2": "t2", "f3": "t3", "f4": "t4", "f5": "t5"}
    with respx.mock(assert_all_called=True) as mock:
        route = mock.route(url__startswith=target_url).respond(200, json={"echo": payload})
        response = client.post(
            "/api/proxy/threat-protection/echo",
            json=payload,
        )

    assert response.status_code == 200
    captured = route.calls.last.request
    assert json.loads(captured.content) == payload
    assert "x-apikey" not in {k.lower() for k in captured.headers}


def test_proxy_threat_protection_json_blocked(fake_config):
    """Upstream 500 (JSON Threat Protection fault) is forwarded with body intact."""
    target_url = f"https://{FAKE_HOST}/v1/samples/threat-protection/echo"
    fault_body = {"fault": {"faultstring": "JSONThreatProtection[JSONTHREAT-Protection]: Execution failed"}}
    with respx.mock(assert_all_called=True) as mock:
        mock.route(url__startswith=target_url).respond(500, json=fault_body)
        response = client.post(
            "/api/proxy/threat-protection/echo",
            json={"f1": "1", "f2": "2", "f3": "3", "f4": "4", "f5": "5", "f6": "6"},
        )

    assert response.status_code == 500
    assert response.json() == fault_body


# ---- /api/cloud-logging/recent ----

class _FakeLogEntry:
    """Mirrors google.cloud.logging_v2.entries.StructEntry.

    A real StructEntry exposes its structured body as ``.payload`` (a dict).
    There is NO ``.json_payload`` or ``.payload_json`` attribute — the latter
    exists only on ProtobufEntry.
    """

    def __init__(self, payload, ts="2026-05-29T12:00:00.000Z"):
        self.payload = payload
        self.timestamp = MagicMock()
        # google.cloud.logging entry timestamps are datetime objects with isoformat;
        # the endpoint must call .isoformat() on it.
        self.timestamp.isoformat.return_value = ts


def test_cloud_logging_recent_returns_entry(fake_config, monkeypatch):
    """When the log API yields one entry, the endpoint returns it."""
    fake_entry = _FakeLogEntry(
        payload={
            "organization": "fake-org",
            "environment": "test1",
            "proxy": "sample-cloud-logging",
            "verb": "GET",
            "response.code": "200",
        },
        ts="2026-05-29T12:00:00.000Z",
    )

    fake_client = MagicMock()
    fake_client.list_entries.return_value = iter([fake_entry])
    monkeypatch.setattr(main, "_get_logging_client", lambda: fake_client)

    response = client.get(
        "/api/cloud-logging/recent",
        params={"after_ts": "2026-05-29T11:59:50.000Z"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["entry"]["jsonPayload"]["proxy"] == "sample-cloud-logging"
    assert body["entry"]["timestamp"] == "2026-05-29T12:00:00.000Z"
    assert "queried_at" in body

    # Filter must include logName, proxy, and a timestamp lower bound.
    args, kwargs = fake_client.list_entries.call_args
    filter_ = kwargs.get("filter_") or (args[0] if args else "")
    assert "logName=" in filter_
    assert 'jsonPayload.proxy="sample-cloud-logging"' in filter_
    assert "timestamp >=" in filter_


def _floor_from_filter(filter_: str) -> datetime:
    """Extract the `timestamp >= "..."` lower bound from a Logging filter."""
    match = re.search(r'timestamp >= "([^"]+)"', filter_)
    assert match, f"no timestamp lower bound in filter: {filter_}"
    return datetime.fromisoformat(match.group(1))


def test_cloud_logging_recent_scopes_to_configured_project(fake_config, monkeypatch):
    """The query must be scoped to the configured PROJECT_ID, not the ADC default.

    list_entries defaults its resource scope to the client's project; if that
    differs from the Apigee project the inline poll silently returns nothing
    while the deep link (explicit project) still works.
    """
    fake_client = MagicMock()
    fake_client.list_entries.return_value = iter([])
    monkeypatch.setattr(main, "_get_logging_client", lambda: fake_client)

    response = client.get("/api/cloud-logging/recent")

    assert response.status_code == 200
    _, kwargs = fake_client.list_entries.call_args
    assert kwargs.get("resource_names") == ["projects/fake-project"]


def test_cloud_logging_recent_floor_is_skew_safe(fake_config, monkeypatch):
    """A client clock running ahead must not exclude a server-stamped entry.

    after_ts comes from the browser's wall clock. If it is ahead of real time,
    a naive `timestamp >= after_ts` filter would exclude the (server-stamped)
    entry forever. The backend must clamp the floor to its own clock minus a
    freshness window.
    """
    fake_client = MagicMock()
    fake_client.list_entries.return_value = iter([])
    monkeypatch.setattr(main, "_get_logging_client", lambda: fake_client)

    before = datetime.now(timezone.utc)
    # Simulate a browser clock running ~1 year ahead of real time.
    response = client.get(
        "/api/cloud-logging/recent",
        params={"after_ts": "2099-01-01T00:00:00.000Z"},
    )
    after = datetime.now(timezone.utc)

    assert response.status_code == 200
    _, kwargs = fake_client.list_entries.call_args
    floor = _floor_from_filter(kwargs["filter_"])
    # Floor must be at/below server time (minus the window), never the future
    # client timestamp — otherwise skew permanently hides the entry.
    assert floor <= after
    assert floor < datetime(2099, 1, 1, tzinfo=timezone.utc)
    # And it should be recent (within the freshness window), not ancient.
    assert floor >= before - main.LOG_FRESHNESS_WINDOW - (after - before)


def test_cloud_logging_recent_empty(fake_config, monkeypatch):
    """No matching entry → entry is null."""
    fake_client = MagicMock()
    fake_client.list_entries.return_value = iter([])
    monkeypatch.setattr(main, "_get_logging_client", lambda: fake_client)

    response = client.get("/api/cloud-logging/recent")

    assert response.status_code == 200
    assert response.json()["entry"] is None


def test_cloud_logging_recent_permission_denied(fake_config, monkeypatch):
    """PermissionDenied surfaces as 403 with actionable guidance."""
    from google.api_core import exceptions as gax

    fake_client = MagicMock()
    fake_client.list_entries.side_effect = gax.PermissionDenied("denied")
    monkeypatch.setattr(main, "_get_logging_client", lambda: fake_client)

    response = client.get("/api/cloud-logging/recent")

    assert response.status_code == 403
    detail = response.json()["detail"]
    assert "roles/logging.viewer" in detail
    assert "Open in Logs Explorer" in detail or "Logs Explorer" in detail


def test_cloud_logging_recent_no_project(monkeypatch):
    """No GCP project → 500 with the same guidance as get_config()."""
    # Force get_config to raise the unconfigured 500.
    main._config_cache = None
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    response = client.get("/api/cloud-logging/recent")

    assert response.status_code == 500
    assert "GOOGLE_CLOUD_PROJECT" in response.json()["detail"]


def test_demos_requires_auth(monkeypatch):
    # Temporarily drop the autouse override to exercise the real 401 path.
    # Auth is off by default locally, so force it on for this test.
    from auth import get_current_user

    monkeypatch.setenv("AUTH_ENABLED", "true")
    app.dependency_overrides.pop(get_current_user, None)
    try:
        resp = client.get("/api/demos")
        assert resp.status_code == 401
    finally:
        # Restore so later tests in this session keep the override.
        app.dependency_overrides[get_current_user] = lambda: {
            "email": "tester@example.com",
            "uid": "test-uid",
        }
