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

"""Tests for mcp_routes.py — focuses on wire format and config gating."""

import json
import os
from unittest.mock import patch

import google.auth.exceptions
from fastapi.testclient import TestClient
from sse_starlette.sse import AppStatus

os.environ.pop("GOOGLE_CLOUD_PROJECT", None)

_adc_patch = patch(
    "google.auth.default",
    side_effect=google.auth.exceptions.DefaultCredentialsError("disabled in tests"),
)
_adc_patch.start()

from main import app  # noqa: E402

import main  # noqa: E402
import pytest  # noqa: E402

FAKE_HOST = "apigee.test.example.com"
FAKE_MCP_CONFIG = {
    "APIGEE_HOST": FAKE_HOST,
    "PROJECT_ID": "fake-project",
    "demos": {
        "apigee-mcp": {
            "mcp_endpoint": f"https://{FAKE_HOST}/crm-mcp-proxy/sse",
            "client_id": "mcp-key-001",
            "client_secret": "mcp-secret-002",
            "model": "gemini-fake",
            "region": "us-east1",
            "status": "passing",
        },
    },
}


@pytest.fixture(autouse=True)
def reset_config_cache():
    main._config_cache = None
    # sse_starlette uses a module-level AppStatus singleton bound to the first
    # test's event loop; reset between tests so subsequent SSE tests don't
    # raise RuntimeError on the stale loop.
    AppStatus.should_exit_event = None
    AppStatus.should_exit = False
    yield
    main._config_cache = None
    AppStatus.should_exit_event = None
    AppStatus.should_exit = False


def _client_with_config(config):
    main._config_cache = config
    return TestClient(app)


def test_get_tools_returns_list():
    async def fake_list_tools(_config):
        return [
            {"name": "list_customers", "description": "List", "openapi_op": "GET /customers"},
            {"name": "get_customer", "description": "Get one", "openapi_op": "GET /customers/{id}"},
        ]

    with patch("mcp_routes.list_tools", side_effect=fake_list_tools):
        client = _client_with_config(FAKE_MCP_CONFIG)
        response = client.get("/api/proxy/apigee-mcp/tools")
    assert response.status_code == 200
    assert response.json() == [
        {"name": "list_customers", "description": "List", "openapi_op": "GET /customers"},
        {"name": "get_customer", "description": "Get one", "openapi_op": "GET /customers/{id}"},
    ]


def test_get_tools_503_when_demo_missing():
    config = {"APIGEE_HOST": FAKE_HOST, "PROJECT_ID": "x", "demos": {}}
    client = _client_with_config(config)
    response = client.get("/api/proxy/apigee-mcp/tools")
    assert response.status_code == 503
    assert "not deployed" in response.json()["detail"]


def test_create_session_returns_uuid():
    client = _client_with_config(FAKE_MCP_CONFIG)
    response = client.post("/api/proxy/apigee-mcp/sessions")
    assert response.status_code == 200
    payload = response.json()
    assert "session_id" in payload
    assert len(payload["session_id"]) >= 16  # UUIDv4 is 36 chars; minimum sanity


def test_create_session_503_when_demo_missing():
    config = {"APIGEE_HOST": FAKE_HOST, "PROJECT_ID": "x", "demos": {}}
    client = _client_with_config(config)
    response = client.post("/api/proxy/apigee-mcp/sessions")
    assert response.status_code == 503


def _parse_sse(body: str):
    """Yield {type, ...} dicts parsed from a `data: ...` SSE stream body."""
    for line in body.splitlines():
        if line.startswith("data:"):
            payload = line[len("data:"):].strip()
            if payload:
                yield json.loads(payload)


def test_chat_streams_events_in_order():
    async def fake_stream_chat(_config, _session_id, _prompt):
        events = [
            {"type": "delta", "text": "Looking up customers..."},
            {"type": "tool_call", "id": "t1", "name": "list_customers", "args": {}},
            {"type": "tool_result", "id": "t1", "status": 200, "body": "[]"},
            {"type": "delta", "text": "Here are 0 customers."},
            {"type": "done"},
        ]
        for ev in events:
            yield ev

    with patch("mcp_routes.stream_chat", side_effect=fake_stream_chat):
        client = _client_with_config(FAKE_MCP_CONFIG)
        response = client.post(
            "/api/proxy/apigee-mcp/chat",
            json={"session_id": "test-sess", "prompt": "list"},
        )
    assert response.status_code == 200
    events = list(_parse_sse(response.text))
    assert events == [
        {"type": "delta", "text": "Looking up customers..."},
        {"type": "tool_call", "id": "t1", "name": "list_customers", "args": {}},
        {"type": "tool_result", "id": "t1", "status": 200, "body": "[]"},
        {"type": "delta", "text": "Here are 0 customers."},
        {"type": "done"},
    ]


def test_chat_emits_error_event_then_done():
    async def fake_stream_chat(_config, _session_id, _prompt):
        yield {"type": "error", "message": "Apigee returned 401"}
        yield {"type": "done"}

    with patch("mcp_routes.stream_chat", side_effect=fake_stream_chat):
        client = _client_with_config(FAKE_MCP_CONFIG)
        response = client.post(
            "/api/proxy/apigee-mcp/chat",
            json={"session_id": "sess-err", "prompt": "x"},
        )
    events = list(_parse_sse(response.text))
    assert events == [
        {"type": "error", "message": "Apigee returned 401"},
        {"type": "done"},
    ]


def test_chat_503_when_demo_missing():
    config = {"APIGEE_HOST": FAKE_HOST, "PROJECT_ID": "x", "demos": {}}
    client = _client_with_config(config)
    response = client.post(
        "/api/proxy/apigee-mcp/chat",
        json={"session_id": "any", "prompt": "x"},
    )
    assert response.status_code == 503


def test_chat_400_when_session_id_missing():
    client = _client_with_config(FAKE_MCP_CONFIG)
    response = client.post(
        "/api/proxy/apigee-mcp/chat",
        json={"prompt": "no session"},
    )
    assert response.status_code == 422
