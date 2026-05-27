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
    "MODEL_NAME": "gemini-fake",
    "MODEL_ARMOR_REGION": "us-central1",
    "BASIC_QUOTA_TRIAL_KEY": "trial-key-123",
    "BASIC_QUOTA_PREMIUM_KEY": "premium-key-456",
    "LLM_SECURITY_KEY": "llm-key-789",
}


@pytest.fixture
def fake_config():
    """Seed main._config_cache so get_config() short-circuits and skips Secret Manager."""
    main._config_cache = dict(FAKE_CONFIG)
    try:
        yield main._config_cache
    finally:
        main._config_cache = None


def test_list_demos_unconfigured():
    """Without GOOGLE_CLOUD_PROJECT the backend reports unconfigured."""
    response = client.get("/api/demos")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unconfigured"
    assert len(data["demos"]) == 2


def test_list_demos_returns_metadata():
    """Check that demo metadata is always present."""
    response = client.get("/api/demos")
    data = response.json()
    ids = [d["id"] for d in data["demos"]]
    assert "basic-quota" in ids
    assert "llm-security" in ids


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
    """x-quota-tier: premium selects BASIC_QUOTA_PREMIUM_KEY."""
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
    """Config present but BASIC_QUOTA_TRIAL_KEY missing → 500 with documented detail."""
    del fake_config["BASIC_QUOTA_TRIAL_KEY"]
    # No respx mock — request should fail before any outbound call
    response = client.get("/api/proxy/basic-quota/")

    assert response.status_code == 500
    assert response.json()["detail"] == "API key not found for basic-quota"
