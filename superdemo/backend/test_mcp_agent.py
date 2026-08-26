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

"""Unit tests for the pure helpers in mcp_agent.py."""

import json

from mcp_agent import adk_event_to_chat_events


class _FakePart:
    def __init__(self, *, text=None, function_call=None, function_response=None):
        self.text = text
        self.function_call = function_call
        self.function_response = function_response


class _FakeFunctionCall:
    def __init__(self, name, args, id):
        self.name = name
        self.args = args
        self.id = id


class _FakeFunctionResponse:
    def __init__(self, name, response, id):
        self.name = name
        self.response = response
        self.id = id


class _FakeContent:
    def __init__(self, parts):
        self.parts = parts


class _FakeEvent:
    def __init__(self, parts, author=None):
        self.content = _FakeContent(parts)
        if author is not None:
            self.author = author


def test_text_part_becomes_delta_event():
    event = _FakeEvent([_FakePart(text="Hello there")])
    result = list(adk_event_to_chat_events(event))
    assert result == [{"type": "delta", "text": "Hello there"}]


def test_function_call_becomes_tool_call_event():
    event = _FakeEvent([
        _FakePart(function_call=_FakeFunctionCall(
            name="list_customers", args={"limit": 5}, id="call-1"
        ))
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "tool_call",
        "id": "call-1",
        "name": "list_customers",
        "args": {"limit": 5},
    }]


def test_function_response_extracts_body_from_mcp_content():
    # MCP tool results arrive as a dumped CallToolResult, not {status, body}.
    event = _FakeEvent([
        _FakePart(function_response=_FakeFunctionResponse(
            name="list_customers",
            response={
                "content": [{"type": "text", "text": '{"customers":[]}'}],
                "isError": False,
            },
            id="call-1",
        ))
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "tool_result",
        "id": "call-1",
        "is_error": False,
        "body": '{"customers":[]}',
    }]


def test_function_response_joins_multiple_text_blocks():
    event = _FakeEvent([
        _FakePart(function_response=_FakeFunctionResponse(
            name="x",
            response={
                "content": [
                    {"type": "text", "text": "line one"},
                    {"type": "text", "text": "line two"},
                ],
                "isError": False,
            },
            id="x-1",
        ))
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "tool_result",
        "id": "x-1",
        "is_error": False,
        "body": "line one\nline two",
    }]


def test_function_response_marks_mcp_error():
    event = _FakeEvent([
        _FakePart(function_response=_FakeFunctionResponse(
            name="x",
            response={
                "content": [{"type": "text", "text": "customer not found"}],
                "isError": True,
            },
            id="x-1",
        ))
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "tool_result",
        "id": "x-1",
        "is_error": True,
        "body": "customer not found",
    }]


def test_function_response_handles_adk_error_wrapper():
    # ADK's run_async wraps transport failures as {"error": "..."}.
    event = _FakeEvent([
        _FakePart(function_response=_FakeFunctionResponse(
            name="x",
            response={"error": "MCP tool execution failed: boom"},
            id="x-1",
        ))
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "tool_result",
        "id": "x-1",
        "is_error": True,
        "body": "MCP tool execution failed: boom",
    }]


def test_function_response_falls_back_to_structured_content():
    event = _FakeEvent([
        _FakePart(function_response=_FakeFunctionResponse(
            name="x",
            response={"content": [], "structuredContent": {"count": 3}},
            id="x-1",
        ))
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "tool_result",
        "id": "x-1",
        "is_error": False,
        "body": '{"count": 3}',
    }]


def test_mixed_parts_emit_in_order():
    event = _FakeEvent([
        _FakePart(text="I'll look that up."),
        _FakePart(function_call=_FakeFunctionCall(
            name="get_customer", args={"id": "1"}, id="t1"
        )),
    ])
    result = list(adk_event_to_chat_events(event))
    assert result == [
        {"type": "delta", "text": "I'll look that up."},
        {"type": "tool_call", "id": "t1", "name": "get_customer", "args": {"id": "1"}},
    ]


def test_empty_event_yields_nothing():
    event = _FakeEvent([])
    assert list(adk_event_to_chat_events(event)) == []


def test_chat_event_json_serializable():
    event = _FakeEvent([_FakePart(text="ok")])
    for chat_event in adk_event_to_chat_events(event):
        # All events must round-trip through json — this is how they're sent on the wire.
        assert json.loads(json.dumps(chat_event)) == chat_event


# ── Session store tests ───────────────────────────────────────────────

import pytest

from mcp_agent import (
    SessionStore,
    is_session_known,
    register_session,
)


def test_session_store_starts_empty():
    store = SessionStore()
    assert not is_session_known(store, "any-id")


def test_register_then_check_session():
    store = SessionStore()
    register_session(store, "sess-1", handle="opaque")
    assert is_session_known(store, "sess-1")
    assert not is_session_known(store, "sess-2")


def test_register_is_idempotent_per_id():
    store = SessionStore()
    register_session(store, "sess-1", handle="first")
    register_session(store, "sess-1", handle="second")
    # The first handle wins. Re-registering the same id does NOT replace it.
    assert store.get("sess-1") == "first"


# ── Toolset cache tests ───────────────────────────────────────────────


from unittest.mock import patch

import mcp_agent
from mcp_agent import McpConfig, _get_or_build_toolset


def _fake_config(endpoint="https://example.test/sse", client_id="key-a"):
    return McpConfig(
        mcp_endpoint=endpoint,
        client_id=client_id,
        model="gemini-fake",
        region="us-central1",
        project_id="fake-project",
    )


def test_get_or_build_toolset_caches_per_config():
    mcp_agent._TOOLSET_CACHE.clear()
    sentinel_a = object()
    with patch("mcp_agent._build_toolset", return_value=sentinel_a) as mock_build:
        config = _fake_config()
        first = _get_or_build_toolset(config)
        second = _get_or_build_toolset(config)
    assert first is sentinel_a
    assert second is sentinel_a
    # Build is only invoked once per (endpoint, client_id) key.
    assert mock_build.call_count == 1


def test_get_or_build_toolset_rebuilds_when_key_changes():
    mcp_agent._TOOLSET_CACHE.clear()
    sentinels = [object(), object()]
    with patch("mcp_agent._build_toolset", side_effect=sentinels) as mock_build:
        _get_or_build_toolset(_fake_config(client_id="key-a"))
        _get_or_build_toolset(_fake_config(client_id="key-b"))
    assert mock_build.call_count == 2


# ── Multi-Agent hierarchy tests ──────────────────────────────────────


def test_event_with_author_includes_agent_name():
    event = _FakeEvent(
        [_FakePart(text="Analyzing complex case...")],
        author="complex_analyst",
    )
    result = list(adk_event_to_chat_events(event))
    assert result == [{
        "type": "delta",
        "text": "Analyzing complex case...",
        "agent": "complex_analyst",
    }]


def test_build_agent_creates_multi_agent_hierarchy():
    from unittest.mock import MagicMock
    from mcp_agent import _build_agent, McpConfig

    mock_toolset = MagicMock()
    config = McpConfig(
        mcp_endpoint="https://example.test/sse",
        client_id="key-a",
        model="gemini-2.5-flash",
        region="us-central1",
        project_id="fake-project",
        pro_model="gemini-2.5-pro",
        flash_model="gemini-2.5-flash",
    )

    with patch("mcp_agent._configure_vertex_env"):
        root_agent = _build_agent(config, mock_toolset)

    assert root_agent.name == "root_coordinator"
    assert root_agent.model == "gemini-2.5-flash"
    assert hasattr(root_agent, "sub_agents")
    assert len(root_agent.sub_agents) == 2

    sub_names = {sa.name: sa for sa in root_agent.sub_agents}
    assert "standard_assistant" in sub_names
    assert "complex_analyst" in sub_names

    assert sub_names["standard_assistant"].model == "gemini-2.5-flash"
    assert sub_names["complex_analyst"].model == "gemini-2.5-pro"
