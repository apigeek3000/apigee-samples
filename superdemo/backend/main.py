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

from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import logging_v2
from google.cloud import secretmanager
from google.api_core import exceptions as gax
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

# CORS is unnecessary in the deployed topology: the frontend (Caddy) and the
# Vite dev server both reverse-proxy /api/* to this backend, so the browser only
# ever talks to a single origin. We therefore add CORS middleware ONLY when
# CORS_ALLOW_ORIGINS is explicitly set (comma-separated origins) — e.g. for a
# cross-origin dev setup. Left unset (the deployed default), the backend emits no
# Access-Control-Allow-Origin header, so its public URL can't be read
# cross-origin from a browser on another site.
_cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",")
    if origin.strip()
]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

from mcp_routes import router as mcp_router  # noqa: E402
from auth import get_current_user  # noqa: E402
from fastapi import Depends  # noqa: E402
app.include_router(mcp_router, dependencies=[Depends(get_current_user)])

# ── Config cache ──────────────────────────────────────────────────────
_config_cache: dict | None = None

# ── Vertex AI bearer token (ADC) ──────────────────────────────────────
# llm-token-limits-v2 deliberately doesn't mint a token in the proxy; it
# expects the caller to attach Authorization: Bearer <token>. Mint one
# here using Application Default Credentials so the same proxy works from
# a browser, mirroring how the google-genai SDK does it from a notebook.
_VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
_credentials = None


# ── Cloud Logging client (ADC) ────────────────────────────────────────
# Lazy-init pattern matching _credentials. The frontend's CloudLoggingDemo
# polls /api/cloud-logging/recent after each proxy request; we read the most
# recent matching entry via list_entries.
_logging_client: "logging_v2.Client | None" = None

# How far back the inline poll searches. Cloud Logging is eventually consistent
# (entries take seconds-to-tens-of-seconds to become queryable via the API), so
# the lower bound is computed from the backend's own clock — never the browser's,
# which can run ahead and permanently exclude the (server-stamped) entry.
LOG_FRESHNESS_WINDOW = timedelta(seconds=120)


def _get_logging_client() -> "logging_v2.Client":
    """Return a cached google-cloud-logging Client. Lazy-initialised via ADC."""
    global _logging_client
    if _logging_client is None:
        _logging_client = logging_v2.Client()
    return _logging_client


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
    "apigee-mcp": {
        "id": "apigee-mcp",
        "title": "MCP Server",
        "description": (
            "Apigee serves as an MCP server: dynamically discovers tools from "
            "Apigee API hub specs and exposes them to a streaming AI agent."
        ),
        "icon": "🔌",
    },
    "cloud-logging": {
        "id": "cloud-logging",
        "title": "Cloud Logging",
        "description": (
            "Apigee MessageLogging policy writes a structured entry to "
            "Google Cloud Logging on every request."
        ),
        "icon": "🪵",
    },
    "threat-protection": {
        "id": "threat-protection",
        "title": "Threat Protection",
        "description": (
            "Apigee RegularExpressionProtection blocks SQL keywords in "
            "query params; JSONThreatProtection rejects oversized JSON "
            "payloads."
        ),
        "icon": "🧱",
    },
    "llm-circuit-breaking": {
        "id": "llm-circuit-breaking",
        "title": "LLM Circuit Breaking",
        "description": (
            "A failover quota trips after 2 requests in 2 minutes, routing "
            "traffic to a secondary Vertex AI region. The response headers "
            "show which target pool actually served each request."
        ),
        "icon": "🚧",
    },
    "llm-token-limits-per-user": {
        "id": "llm-token-limits-per-user",
        "title": "Per-User Token Limits",
        "description": (
            "LLM token quotas enforced per end user via an x-userid header, "
            "not per app. Two users sharing one API key get independent token "
            "budgets — exhaust one and the other still gets through."
        ),
        "icon": "👤",
    },
    "llm-semantic-cache-v2": {
        "id": "llm-semantic-cache-v2",
        "title": "LLM Semantic Cache",
        "description": (
            "Apigee's SemanticCacheLookup embeds each prompt and searches a "
            "Vertex AI Vector Search index; a semantically-similar prompt is "
            "served straight from the cache, skipping the model call. Latency "
            "shows the speedup."
        ),
        "icon": "🧠",
    },
    "llm-routing": {
        "id": "llm-routing",
        "title": "LLM Model Routing",
        "description": (
            "Routes prompts between cheap and premium models based on policy."
        ),
        "icon": "🔀",
        "placeholder": True,
    },
    "llm-logging": {
        "id": "llm-logging",
        "title": "LLM Logging",
        "description": (
            "Logs prompt/response pairs through Apigee for audit and analytics."
        ),
        "icon": "📜",
        "placeholder": True,
    },
    "llm-function-calling": {
        "id": "llm-function-calling",
        "title": "LLM Function Calling",
        "description": (
            "Brokers LLM tool/function calls through Apigee with policy enforcement."
        ),
        "icon": "🔧",
        "placeholder": True,
    },
}


def _demo_with_metadata(demo: dict, demo_config: dict) -> dict:
    """Enrich a static DEMO_METADATA entry with secret-sourced fields."""
    if demo.get("placeholder"):
        return {**demo, "status": "placeholder"}
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
    elif demo["id"] == "apigee-mcp":
        for field in ("mcp_endpoint", "model", "region"):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    elif demo["id"] == "cloud-logging":
        for field in ("log_name", "proxy_name"):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    elif demo["id"] == "threat-protection":
        for field in ("max_json_object_keys", "blocked_keywords"):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    elif demo["id"] == "llm-circuit-breaking":
        for field in (
            "primary_region",
            "secondary_region",
            "failover_threshold",
            "window_minutes",
            "model",
        ):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    elif demo["id"] == "llm-token-limits-per-user":
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
    elif demo["id"] == "llm-semantic-cache-v2":
        for field in (
            "model",
            "region",
            "embeddings_model",
            "similarity_threshold",
            "ttl_seconds",
        ):
            value = demo_config.get(field)
            if value is not None:
                enriched[field] = value
    return enriched


@app.get("/api/demos", dependencies=[Depends(get_current_user)])
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


@app.post("/api/config/reload", dependencies=[Depends(get_current_user)])
def reload_config():
    """Force-refresh the cached config from Secret Manager."""
    global _config_cache
    _config_cache = None
    get_config()
    return {"status": "reloaded"}


@app.get("/api/cloud-logging/recent", dependencies=[Depends(get_current_user)])
def cloud_logging_recent(after_ts: str | None = None) -> dict:
    """
    Return the most recent sample-cloud-logging entry, best-effort.

    Frontend captures an ISO timestamp before sending the proxy request and
    polls this endpoint until the matching entry is visible. Cloud Logging
    has ~2-10s of eventual consistency, so callers should expect transient
    empty responses.
    """
    config = get_config()  # raises HTTPException(500) if unconfigured
    project_id = config.get("PROJECT_ID")
    if not project_id:
        raise HTTPException(
            status_code=500,
            detail="PROJECT_ID missing from superdemo config",
        )

    now = datetime.now(timezone.utc)
    queried_at = now.isoformat()

    # Lower bound for the search. Clamp the caller-supplied timestamp to our own
    # clock before subtracting the freshness window, so a browser clock running
    # ahead can never push the floor past the server-stamped entry.
    floor = now
    if after_ts:
        try:
            client_ts = datetime.fromisoformat(after_ts.replace("Z", "+00:00"))
            floor = min(floor, client_ts)
        except (ValueError, TypeError):
            pass
    floor = floor - LOG_FRESHNESS_WINDOW

    filter_ = " AND ".join(
        [
            f'logName="projects/{project_id}/logs/apigee"',
            'jsonPayload.proxy="sample-cloud-logging"',
            f'timestamp >= "{floor.isoformat()}"',
        ]
    )

    try:
        log_client = _get_logging_client()
        # Scope to the configured project explicitly; list_entries otherwise
        # defaults to the ADC project, which may differ from the Apigee project.
        entries = log_client.list_entries(
            resource_names=[f"projects/{project_id}"],
            filter_=filter_,
            order_by=logging_v2.DESCENDING,
            page_size=1,
        )
        entry = next(iter(entries), None)
    except google.auth.exceptions.DefaultCredentialsError as e:
        raise HTTPException(
            status_code=500,
            detail=(
                "No Google Cloud credentials available for Cloud Logging. "
                "Run `gcloud auth application-default login` for local dev, "
                "or attach a service account when deployed."
            ),
        ) from e
    except gax.PermissionDenied as e:
        raise HTTPException(
            status_code=403,
            detail=(
                "Backend identity needs roles/logging.viewer on the project "
                "to fetch logs inline. The 'Open in Logs Explorer' button "
                "still works."
            ),
        ) from e

    if entry is None:
        return {"entry": None, "queried_at": queried_at}

    return {
        "entry": {
            "timestamp": entry.timestamp.isoformat(),
            "jsonPayload": dict(entry.payload) if entry.payload else {},
        },
        "queried_at": queried_at,
    }


# Demos whose sibling Apigee proxy enforces VerifyAPIKey. The two unsecured
# demos (cloud-logging, threat-protection) are deliberately absent — the
# backend must not inject a key for them. apigee-mcp is not here because its
# routes are owned by mcp_routes.py, not proxy_request.
DEMOS_REQUIRING_KEY = {
    "basic-quota",
    "llm-security",
    "llm-token-limits-v2",
    "llm-token-limits-per-user",
}

# Demos whose sibling proxy target has no <GoogleAccessToken> and therefore
# expects the caller to attach an OAuth bearer token for Vertex AI.
DEMOS_REQUIRING_VERTEX_TOKEN = {
    "llm-token-limits-v2",
    "llm-circuit-breaking",
    "llm-token-limits-per-user",
    "llm-semantic-cache-v2",
}


@app.api_route(
    "/api/proxy/{demo_name}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
    dependencies=[Depends(get_current_user)],
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
    elif demo_name == "cloud-logging":
        api_key = None
        target_url = f"https://{host}/v1/samples/cloud-logging"
    elif demo_name == "threat-protection":
        api_key = None
        target_url = f"https://{host}/v1/samples/threat-protection/{path}"
    elif demo_name == "llm-circuit-breaking":
        api_key = None
        target_url = f"https://{host}/v1/samples/llm-circuit-breaking/{path}"
    elif demo_name == "llm-token-limits-per-user":
        tier = request.headers.get("x-rate-limit-tier", "bronze")
        if tier not in ("bronze", "silver"):
            tier = "bronze"
        block = config.get("demos", {}).get("llm-token-limits-per-user", {})
        api_key = block.get(f"{tier}_key")
        target_url = f"https://{host}/v1/samples/llm-token-limits-per-user/{path}"
    elif demo_name == "llm-semantic-cache-v2":
        api_key = None
        target_url = f"https://{host}/v2/samples/llm-semantic-cache/{path}"
    else:
        raise HTTPException(status_code=404, detail=f"Unknown demo: {demo_name}")

    if demo_name in DEMOS_REQUIRING_KEY and not api_key:
        raise HTTPException(
            status_code=500, detail=f"API key not found for {demo_name}"
        )

    # Build outbound headers — drop hop-by-hop headers and the caller's
    # Authorization (the browser's Firebase ID token). Each demo attaches its
    # own upstream credential below (x-apikey, and a minted Vertex bearer for
    # llm-token-limits-v2), so the inbound token must never leak upstream.
    drop_headers = {"host", "content-length", "transfer-encoding", "authorization"}
    out_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in drop_headers
    }
    if demo_name in DEMOS_REQUIRING_KEY:
        out_headers["x-apikey"] = api_key

    # These proxies' target XML has no <GoogleAccessToken>, so Vertex expects the
    # caller to supply the OAuth bearer token. (llm-security's proxy DOES mint its
    # own, so it must never appear here.)
    if demo_name in DEMOS_REQUIRING_VERTEX_TOKEN:
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
