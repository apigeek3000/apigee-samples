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
from unittest.mock import patch

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
    """Without GOOGLE_CLOUD_PROJECT the backend reports unconfigured."""
    response = client.get("/api/demos")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unconfigured"
    assert len(data["demos"]) == 9


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


def test_unconfigured_demos_all_unknown():
    """No config at all → every real demo gets status=unknown."""
    response = client.get("/api/demos")
    data = response.json()
    assert data["status"] == "unconfigured"
    for demo in data["demos"]:
        if demo.get("placeholder"):
            continue
        assert demo["status"] == "unknown"


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
