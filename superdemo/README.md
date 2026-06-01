# Superdemo

A browser-based playground for the `basic-quota`, `llm-security-v2`, and
`llm-token-limits-v2` Apigee sample proxies. It replaces hand-rolled `curl`
commands with a UI that visualizes Apigee in action.

A FastAPI backend reads the deployed API keys from Google Cloud Secret Manager
and acts as a signed reverse proxy, so keys never reach the browser. A React
SPA renders one view per demo and talks only to the backend.

For a presenter-facing walkthrough of each demo — what to click, what to
say, what the audience should notice — see [GUIDE.md](GUIDE.md).

## Wired-up demos

- **Basic Quota** — Demonstrates Apigee Quota policies. Trial tier allows 10 requests/minute. Premium tier allows 1000 requests/hour.
- **LLM Security v2** — Routes prompts through Google Cloud Model Armor for threat protection before forwarding to Vertex AI.
- **LLM Rate Limiting** — Demonstrates Apigee's LLMTokenQuota AI policy. Bronze tier allows 2000 tokens per 5 minutes; silver allows 5000. Same prompt is sent to both tiers in parallel.
- **MCP Server** — Apigee serves as an MCP server: dynamically discovers tools from Apigee API hub specs and exposes them to a streaming AI agent.
- **Cloud Logging** — Apigee MessageLogging policy writes a structured entry to Google Cloud Logging on every request.
- **Threat Protection** — Apigee RegularExpressionProtection blocks SQL keywords in query params; JSONThreatProtection rejects oversized JSON payloads.

## Prerequisites

**Google Cloud:**
- A GCP project that you are owner of with [Apigee X provisioned](https://docs.cloud.google.com/apigee/docs/api-platform/get-started/provisioning-intro) and external access configured
- Create your Model Armor template (see [`llm-security-v2/README.md`](../llm-security-v2/README.md))

**Used by the deploy scripts:** [gcloud CLI](https://cloud.google.com/sdk/docs/install),
[apigeecli](https://github.com/apigee/apigeecli) (auto-installed by the
deploy script), `jq`, `curl`, `unzip`, `sed`, `bash`.

**Used by the app:** Python 3.9+ with [`uv`](https://docs.astral.sh/uv/), Node.js 18+ with `npm`.

**Cloud Logging demo permissions:** The Cloud Logging demo's inline "recent log entry" panel calls the Cloud Logging API from the FastAPI backend using Application Default Credentials. The identity backing those credentials (your local `gcloud auth application-default` user during dev, or the runtime service account when deployed) needs `roles/logging.viewer` on the project. Without it, the inline panel shows an error pointing to this requirement — the "Open in Logs Explorer" deep-link still works because it opens in the user's own browser session.

Authenticate and set the active project (one-time):

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
4. Deploy both proxies and store the resulting keys in the `superdemo-config` secret:
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

## Demo status indicators

The sidebar shows a colored dot next to each demo: green for passing, amber
for failing, red for undeployed, gray for unknown. The toggle at the bottom
of the sidebar hides the dots — useful during live customer demos when you'd
rather not advertise that something is currently broken. The setting persists
in localStorage. Status is set by `deploy-superdemo.sh` at the end of each
run, so re-running it refreshes every demo's status.