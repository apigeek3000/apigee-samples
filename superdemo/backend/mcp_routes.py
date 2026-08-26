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

"""Routes for the apigee-mcp demo: /tools, /sessions, /chat (SSE)."""

import asyncio
import json
import logging
import uuid
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

import main as _main  # for get_config — kept indirect to avoid circular imports
from mcp_agent import McpConfig, list_tools, stream_chat

logger = logging.getLogger(__name__)
router = APIRouter()


def _mcp_block_or_503(config: Dict[str, Any]) -> Dict[str, Any]:
    block = (config.get("demos") or {}).get("apigee-mcp") or {}
    required = ("mcp_endpoint", "client_id", "model", "region")
    if any(not block.get(k) for k in required):
        raise HTTPException(
            status_code=503,
            detail="apigee-mcp not deployed — run deploy-superdemo.sh",
        )
    return block


def _config_from_secret(config: Dict[str, Any], block: Dict[str, Any]) -> McpConfig:
    import os

    flash_model = (
        block.get("flash_model")
        or os.environ.get("FLASH_MODEL_NAME")
        or block.get("model")
        or os.environ.get("MODEL_NAME")
        or "gemini-2.5-flash"
    )
    pro_model = (
        block.get("pro_model")
        or os.environ.get("PRO_MODEL_NAME")
        or "gemini-2.5-pro"
    )
    return McpConfig(
        mcp_endpoint=block["mcp_endpoint"],
        client_id=block["client_id"],
        model=block.get("model") or flash_model,
        region=block["region"],
        project_id=config.get("PROJECT_ID") or "",
        flash_model=flash_model,
        pro_model=pro_model,
    )


@router.get("/api/proxy/apigee-mcp/tools")
async def get_tools():
    config = _main.get_config()
    block = _mcp_block_or_503(config)
    mcp_config = _config_from_secret(config, block)
    return await list_tools(mcp_config)


@router.post("/api/proxy/apigee-mcp/sessions")
def create_session():
    _mcp_block_or_503(_main.get_config())
    return {"session_id": str(uuid.uuid4())}


class ChatRequest(BaseModel):
    session_id: str
    prompt: str


@router.post("/api/proxy/apigee-mcp/chat")
async def post_chat(req: ChatRequest, request: Request):
    config = _main.get_config()
    block = _mcp_block_or_503(config)
    mcp_config = _config_from_secret(config, block)

    async def event_source():
        try:
            async for chat_event in stream_chat(mcp_config, req.session_id, req.prompt):
                if await request.is_disconnected():
                    return
                yield {"data": json.dumps(chat_event)}
        except asyncio.CancelledError:
            return

    return EventSourceResponse(event_source())
