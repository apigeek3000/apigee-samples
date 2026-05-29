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

"""Apigee MCP demo agent runner.

This module owns the ADK runner, the MCP toolset wiring, and the per-session
state for the streaming chat. Public surface:

  - `adk_event_to_chat_events(event)` — pure: translate one ADK event into the
    wire-format ChatEvent dicts emitted on the SSE stream.
  - `list_tools(config)` — async: returns the discovered MCP tools.
  - `stream_chat(config, session_id, prompt)` — async generator yielding
    ChatEvent dicts.

The functions that touch ADK / MCP are kept thin so the bulk of the logic
(event translation) can be unit-tested without a live MCP server.
"""

import os
from dataclasses import dataclass
from typing import Any, Dict, Iterator, Tuple

# ── Wire-format chat event types ─────────────────────────────────────

ChatEvent = Dict[str, Any]
"""One SSE event. Keys depend on `type`:

  {"type": "delta", "text": "..."}
  {"type": "tool_call", "id": "...", "name": "...", "args": {...}}
  {"type": "tool_result", "id": "...", "status": <int>, "body": "..."}
  {"type": "done"}
  {"type": "error", "message": "..."}
  {"type": "session_restarted", "session_id": "..."}
"""


# ── Pure translation: ADK Event → ChatEvent(s) ───────────────────────


def adk_event_to_chat_events(event: Any) -> Iterator[ChatEvent]:
    """Translate one ADK event into zero or more ChatEvents.

    ADK events carry `content.parts`, each of which is one of:
      - text:              a `text` attribute
      - function_call:     a `function_call` attribute (`.name`, `.args`, `.id`)
      - function_response: a `function_response` attribute (`.name`, `.response`, `.id`)

    Each part maps to exactly one ChatEvent. Empty events (no parts) emit nothing.
    """
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) or []

    for part in parts:
        text = getattr(part, "text", None)
        if text:
            yield {"type": "delta", "text": text}
            continue

        call = getattr(part, "function_call", None)
        if call is not None:
            yield {
                "type": "tool_call",
                "id": getattr(call, "id", ""),
                "name": getattr(call, "name", ""),
                "args": getattr(call, "args", {}) or {},
            }
            continue

        resp = getattr(part, "function_response", None)
        if resp is not None:
            response = getattr(resp, "response", {}) or {}
            status = response.get("status", 0) if isinstance(response, dict) else 0
            body = response.get("body", "") if isinstance(response, dict) else str(response)
            yield {
                "type": "tool_result",
                "id": getattr(resp, "id", ""),
                "status": status,
                "body": body,
            }
            continue


# ── Session store (in-memory; lost on backend restart) ───────────────


class SessionStore:
    """Maps session_id → opaque session handle. Backend-restart-ephemeral."""

    def __init__(self) -> None:
        self._sessions: Dict[str, Any] = {}

    def get(self, session_id: str) -> Any:
        return self._sessions.get(session_id)

    def set_if_absent(self, session_id: str, handle: Any) -> None:
        if session_id not in self._sessions:
            self._sessions[session_id] = handle


def is_session_known(store: SessionStore, session_id: str) -> bool:
    return store.get(session_id) is not None


def register_session(store: SessionStore, session_id: str, handle: Any) -> None:
    store.set_if_absent(session_id, handle)


# Module-level singleton; routes import this rather than constructing their own.
_SESSIONS = SessionStore()


# ── ADK wiring ───────────────────────────────────────────────────────
#
# Imports are deferred so the module loads (and pure helpers are testable)
# even if google-adk isn't installed in the active environment.


@dataclass
class McpConfig:
    """Fields the agent needs from superdemo-config.demos['apigee-mcp']."""

    mcp_endpoint: str
    client_id: str
    model: str
    region: str
    project_id: str


def _build_toolset(config: McpConfig) -> Any:
    from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, SseConnectionParams

    return MCPToolset(
        connection_params=SseConnectionParams(
            url=config.mcp_endpoint,
            headers={"x-api-key": config.client_id},
        ),
    )


# Cached toolsets keyed by (mcp_endpoint, client_id). One toolset = one SSE
# session against the MCP server. Sharing across /tools and /chat avoids the
# upstream crm-mcp-service bug where a second server.connect() throws
# "Already connected to a transport" and crashes the Cloud Run container.
_TOOLSET_CACHE: Dict[Tuple[str, str], Any] = {}


def _get_or_build_toolset(config: McpConfig) -> Any:
    key = (config.mcp_endpoint, config.client_id)
    toolset = _TOOLSET_CACHE.get(key)
    if toolset is None:
        toolset = _build_toolset(config)
        _TOOLSET_CACHE[key] = toolset
    return toolset


def _configure_vertex_env(config: McpConfig) -> None:
    # Point google-genai (wrapped by ADK) at Vertex AI + ADC. Without this it
    # defaults to the Gemini Developer API and demands GOOGLE_API_KEY.
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
    os.environ["GOOGLE_CLOUD_PROJECT"] = config.project_id
    os.environ["GOOGLE_CLOUD_LOCATION"] = config.region


def _build_agent(config: McpConfig, toolset: Any) -> Any:
    from google.adk.agents import Agent

    _configure_vertex_env(config)
    return Agent(
        name="apigee_mcp_demo",
        model=config.model,
        tools=[toolset],
        instruction=(
            "You are a helpful CRM assistant. Use the available tools to answer "
            "the user's questions. Cite tool results when summarizing data."
        ),
    )


def _build_runner(agent: Any) -> Any:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService

    return Runner(
        agent=agent,
        app_name="superdemo-apigee-mcp",
        session_service=InMemorySessionService(),
    )


async def list_tools(config: McpConfig):
    """Return the tools the agent's MCP toolset has discovered, as plain dicts.

    Each tool: {"name", "description", "openapi_op"}.
    `openapi_op` is best-effort: pulled from the tool's MCP metadata if present,
    otherwise empty.

    Note: In ADK 1.34.1, `MCPToolset.get_tools()` is an async method that
    accepts an optional `readonly_context` argument (defaulting to None).
    """
    toolset = _get_or_build_toolset(config)
    tools = await toolset.get_tools()
    out = []
    for tool in tools:
        name = getattr(tool, "name", "")
        description = getattr(tool, "description", "") or ""
        metadata = getattr(tool, "metadata", {}) or {}
        openapi_op = ""
        if isinstance(metadata, dict):
            method = metadata.get("method") or metadata.get("http_method")
            path = metadata.get("path") or metadata.get("http_path")
            if method and path:
                openapi_op = f"{method.upper()} {path}"
        out.append(
            {
                "name": name,
                "description": description,
                "openapi_op": openapi_op,
            }
        )
    return out


async def stream_chat(config: McpConfig, session_id: str, prompt: str):
    """Yield ChatEvent dicts for one user prompt.

    If `session_id` isn't in the in-memory store, the first event is
    `{"type": "session_restarted", "session_id": "<id>"}` and the agent runs
    against a fresh ADK session.

    Final event is always `{"type": "done"}` (also on error).

    Note: In ADK 1.34.1, `Runner.run_async` is called with keyword args
    `user_id`, `session_id`, and `new_message` (a `google.genai.types.Content`).
    `create_session` accepts keyword args `app_name`, `user_id`, `session_id`.
    """
    from google.genai.types import Content, Part

    new_session = not is_session_known(_SESSIONS, session_id)
    if new_session:
        yield {"type": "session_restarted", "session_id": session_id}

    try:
        handle = _SESSIONS.get(session_id)
        if handle is None:
            toolset = _get_or_build_toolset(config)
            agent = _build_agent(config, toolset)
            runner = _build_runner(agent)
            await runner.session_service.create_session(
                app_name="superdemo-apigee-mcp",
                user_id=session_id,
                session_id=session_id,
            )
            register_session(_SESSIONS, session_id, runner)
            handle = runner

        runner = handle
        new_message = Content(role="user", parts=[Part(text=prompt)])

        async for event in runner.run_async(
            user_id=session_id,
            session_id=session_id,
            new_message=new_message,
        ):
            for chat_event in adk_event_to_chat_events(event):
                yield chat_event
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": str(e)}

    yield {"type": "done"}
