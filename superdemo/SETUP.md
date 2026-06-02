# Superdemo setup

Setup, deploy, and local-development guide for the Superdemo. For an overview of what the app is, see [README.md](README.md). For a presenter-facing walkthrough of each demo, see [GUIDE.md](GUIDE.md).

## Prerequisites

**Google Cloud:**
- A GCP project that you are Owner of with the compute.requireShieldedVm Org Policy disabled
- [Apigee X provisioned](https://docs.cloud.google.com/apigee/docs/api-platform/get-started/provisioning-intro). A [free evaluation org](https://docs.cloud.google.com/apigee/docs/api-platform/get-started/eval-orgs) works just fine. Be sure to Configure your Apigee organization with external access enabled.
- Create your Model Armor template (see [`llm-security-v2/README.md`](../llm-security-v2/README.md)) — used by the **LLM Security v2** demo
- Enable Apigee API Hub (see [`apigee-mcp/README.md`](../apigee-mcp/README.md)) — used by the **MCP Server** demo to discover tool specs

**Used by the deploy scripts:** 
- [gcloud CLI](https://cloud.google.com/sdk/docs/install),
- [apigeecli](https://github.com/apigee/apigeecli) (auto-installed by the deploy script)

**Used by the app:** 
- Python 3.9+ with [`uv`](https://docs.astral.sh/uv/)
- Node.js 18+ with `npm`.

**Authenticate and set the active project:**
```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
gcloud auth login
gcloud auth application-default login
gcloud config set project $GOOGLE_CLOUD_PROJECT
gcloud auth application-default set-quota-project $GOOGLE_CLOUD_PROJECT
```

## Demo setup (once)

1. Copy the [`superdemo/deploy/env.sh`](deploy/env.sh) file so that your personal values don't get checked into version control
```bash
cp ./superdemo/deploy/env.sh ./superdemo/deploy/secret.sh
```
2. Edit [`superdemo/deploy/secret.sh`](deploy/secret.sh) — fill in with your values
3. Source it:
```bash
source ./superdemo/deploy/secret.sh
```
4. Deploy all demo proxies and store the resulting keys in the `superdemo-config` secret:
```bash
./superdemo/deploy/deploy-superdemo.sh
```

To tear everything down: `./superdemo/deploy/clean-superdemo.sh`.

## Local dev

Two terminals, one each for the backend and frontend.

```bash
# Backend (http://localhost:8000)
cd superdemo/backend
uv sync
uv run uvicorn main:app --reload --port 8000

# Frontend (http://localhost:5173)
cd superdemo/frontend
npm install
npm run dev
```

Vite proxies `/api/*` to the backend, so the app uses same-origin requests
with no CORS setup. Open http://localhost:5173 and pick a demo from the
sidebar.

Backend API docs: FastAPI auto-generates interactive Swagger UI at
http://localhost:8000/docs and ReDoc at http://localhost:8000/redoc. The
raw OpenAPI schema is at http://localhost:8000/openapi.json.

For a presenter-facing walkthrough of each demo, see [GUIDE.md](GUIDE.md).

## Unit testing

Each part of the stack has its own test runner:

```bash
# Backend (pytest + respx for HTTP mocking)
cd superdemo/backend && uv run pytest

# Frontend (vitest — single pass, CI mode)
cd superdemo/frontend && npm test -- --run

# Deploy bash helpers
bash superdemo/deploy/lib.test.sh
```
