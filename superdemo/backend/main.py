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
}


@app.get("/api/demos")
def list_demos():
    """Return available demos and backend readiness status."""
    try:
        config = get_config()
        return {
            "status": "ready",
            "host": config.get("APIGEE_HOST"),
            "project_id": config.get("PROJECT_ID"),
            "model_name": config.get("MODEL_NAME"),
            "model_armor_region": config.get("MODEL_ARMOR_REGION"),
            "demos": list(DEMO_METADATA.values()),
        }
    except HTTPException:
        return {"status": "unconfigured", "demos": list(DEMO_METADATA.values())}


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
        key_name = f"BASIC_QUOTA_{tier.upper()}_KEY"
        api_key = config.get(key_name)
        target_url = f"https://{host}/v1/samples/basic-quota"
    elif demo_name == "llm-security":
        api_key = config.get("LLM_SECURITY_KEY")
        target_url = f"https://{host}/v2/samples/llm-security/{path}"
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
