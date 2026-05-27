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

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import secretmanager
import google.auth
import google.auth.exceptions
import google.auth.transport.requests
import httpx
import os
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Superdemo Backend",
    description="Reverse proxy for Apigee demo proxies",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config cache ──────────────────────────────────────────────────────
_config_cache: dict | None = None

# ── Vertex AI bearer token (ADC) ──────────────────────────────────────
# llm-token-limits-v2 deliberately doesn't mint a token in the proxy; it
# expects the caller to attach Authorization: Bearer <token>. Mint one
# here using Application Default Credentials so the same proxy works from
# a browser, mirroring how the google-genai SDK does it from a notebook.
_VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
_credentials = None


def _get_bearer_token() -> str:
    """Return a fresh OAuth bearer token for Vertex AI via ADC."""
    global _credentials
    if _credentials is None:
        _credentials, _ = google.auth.default(scopes=[_VERTEX_SCOPE])
    if not _credentials.valid:
        _credentials.refresh(google.auth.transport.requests.Request())
    return _credentials.token


def get_config() -> dict:
    """Load the superdemo config from Google Secret Manager (cached)."""
    global _config_cache
    if _config_cache:
        return _config_cache

    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        try:
            _, project_id = google.auth.default()
        except google.auth.exceptions.DefaultCredentialsError:
            project_id = None
    if not project_id:
        raise HTTPException(
            status_code=500,
            detail=(
                "No GCP project found. Set GOOGLE_CLOUD_PROJECT or run "
                "`gcloud auth application-default login` followed by "
                "`gcloud auth application-default set-quota-project <project>`."
            ),
        )

    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{project_id}/secrets/superdemo-config/versions/latest"
    try:
        response = client.access_secret_version(request={"name": name})
        payload = response.payload.data.decode("UTF-8")
        _config_cache = json.loads(payload)
        logger.info("Loaded config from Secret Manager")
        return _config_cache
    except Exception as e:
        logger.error("Failed to load config: %s", e)
        raise HTTPException(
            status_code=500, detail=f"Failed to load config: {e}"
        )


# ── Demo registry ────────────────────────────────────────────────────
DEMO_METADATA = {
    "basic-quota": {
        "id": "basic-quota",
        "title": "Basic Quota",
        "description": "Demonstrates Apigee Quota policies. "
        "Trial tier allows 10 requests/minute. "
        "Premium tier allows 1000 requests/hour.",
        "icon": "⏱️",
    },
    "llm-security": {
        "id": "llm-security",
        "title": "LLM Security v2",
        "description": "Routes prompts through Google Cloud Model Armor "
        "for threat protection before forwarding to Vertex AI.",
        "icon": "🛡️",
    },
    "llm-token-limits-v2": {
        "id": "llm-token-limits-v2",
        "title": "LLM Rate Limiting",
        "description": (
            "Demonstrates Apigee's LLMTokenQuota AI policy. Bronze tier "
            "allows 2000 tokens per 5 minutes; silver allows 5000. Same "
            "prompt is sent to both tiers in parallel."
        ),
        "icon": "⚡",
    },
}


def _demo_with_metadata(demo: dict, demo_config: dict) -> dict:
    """Enrich a static DEMO_METADATA entry with secret-sourced fields."""
    enriched = {**demo, "status": demo_config.get("status", "unknown")}
    if demo["id"] == "llm-security":
        for field in ("model_name", "model_armor_region"):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    elif demo["id"] == "llm-token-limits-v2":
        for field in (
            "bronze_token_limit",
            "silver_token_limit",
            "interval_minutes",
            "model",
            "region",
        ):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    return enriched


@app.get("/api/demos")
def list_demos():
    """Return available demos with per-demo status and llm-security model config."""
    try:
        config = get_config()
        demos_block = config.get("demos", {})
        return {
            "status": "ready",
            "host": config.get("APIGEE_HOST"),
            "project_id": config.get("PROJECT_ID"),
            "demos": [
                _demo_with_metadata(demo, demos_block.get(demo["id"], {}))
                for demo in DEMO_METADATA.values()
            ],
        }
    except HTTPException:
        return {
            "status": "unconfigured",
            "demos": [
                _demo_with_metadata(demo, {}) for demo in DEMO_METADATA.values()
            ],
        }


@app.post("/api/config/reload")
def reload_config():
    """Force-refresh the cached config from Secret Manager."""
    global _config_cache
    _config_cache = None
    get_config()
    return {"status": "reloaded"}


@app.api_route(
    "/api/proxy/{demo_name}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
)
async def proxy_request(demo_name: str, path: str, request: Request):
    """
    Reverse-proxy requests to the deployed Apigee endpoints.
    The API key is injected server-side — never exposed to the browser.
    """
    config = get_config()
    host = config.get("APIGEE_HOST")

    if demo_name == "basic-quota":
        tier = request.headers.get("x-quota-tier", "trial")
        basic_quota = config.get("demos", {}).get("basic-quota", {})
        api_key = basic_quota.get(f"{tier}_key")
        target_url = f"https://{host}/v1/samples/basic-quota"
    elif demo_name == "llm-security":
        llm_security = config.get("demos", {}).get("llm-security", {})
        api_key = llm_security.get("key")
        target_url = f"https://{host}/v2/samples/llm-security/{path}"
    elif demo_name == "llm-token-limits-v2":
        tier = request.headers.get("x-rate-limit-tier", "bronze")
        if tier not in ("bronze", "silver"):
            tier = "bronze"
        block = config.get("demos", {}).get("llm-token-limits-v2", {})
        api_key = block.get(f"{tier}_key")
        target_url = f"https://{host}/v2/samples/llm-token-limits/{path}"
    else:
        raise HTTPException(status_code=404, detail=f"Unknown demo: {demo_name}")

    if not api_key:
        raise HTTPException(
            status_code=500, detail=f"API key not found for {demo_name}"
        )

    # Build outbound headers — drop hop-by-hop headers
    drop_headers = {"host", "content-length", "transfer-encoding"}
    out_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in drop_headers
    }
    out_headers["x-apikey"] = api_key

    # llm-token-limits-v2's target XML has no <GoogleAccessToken>, so
    # Vertex expects the caller to supply the OAuth bearer token.
    if demo_name == "llm-token-limits-v2":
        try:
            out_headers["Authorization"] = f"Bearer {_get_bearer_token()}"
        except google.auth.exceptions.DefaultCredentialsError as e:
            raise HTTPException(
                status_code=500,
                detail=(
                    "No Google Cloud credentials available. Run "
                    "`gcloud auth application-default login` for local "
                    "dev, or attach a service account when deployed."
                ),
            ) from e

    # For basic-quota the proxy expects the key as a query param
    params = dict(request.query_params)
    if demo_name == "basic-quota":
        params["apikey"] = api_key

    body = await request.body()

    async with httpx.AsyncClient(timeout=60.0) as client:
        proxy_resp = await client.request(
            method=request.method,
            url=target_url,
            headers=out_headers,
            params=params,
            content=body,
        )

    # Forward the response, stripping hop-by-hop headers
    resp_drop = {"transfer-encoding", "content-encoding", "content-length"}
    resp_headers = {
        k: v
        for k, v in proxy_resp.headers.items()
        if k.lower() not in resp_drop
    }

    return Response(
        content=proxy_resp.content,
        status_code=proxy_resp.status_code,
        headers=resp_headers,
    )
