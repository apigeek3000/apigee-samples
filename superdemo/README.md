# Superdemo

A browser-based playground for the `basic-quota` and `llm-security-v2` Apigee
sample proxies. It replaces hand-rolled `curl` commands with a UI that
visualizes quota enforcement and Model Armor in action.

A FastAPI backend reads the deployed API keys from Google Cloud Secret Manager
and acts as a signed reverse proxy, so keys never reach the browser. A React
SPA renders one view per demo and talks only to the backend.

## Prerequisites

**Google Cloud:**
- A project with [Apigee X provisioned](https://docs.cloud.google.com/apigee/docs/api-platform/get-started/provisioning-intro) and external access configured
- Create your Model Armor template (see [`llm-security-v2/README.md`](../llm-security-v2/README.md))

**Used by the deploy scripts:** [gcloud CLI](https://cloud.google.com/sdk/docs/install),
[apigeecli](https://github.com/apigee/apigeecli) (auto-installed by the
deploy script), `jq`, `curl`, `unzip`, `sed`, `bash`.

**Used by the app:** Python 3.9+ with [`uv`](https://docs.astral.sh/uv/), Node.js 18+ with `npm`.

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

## Demo status indicators

The sidebar shows a colored dot next to each demo: green for passing, amber
for failing, red for undeployed, gray for unknown. The toggle at the bottom
of the sidebar hides the dots — useful during live customer demos when you'd
rather not advertise that something is currently broken. The setting persists
in localStorage. Status is set by `deploy-superdemo.sh` at the end of each
run, so re-running it refreshes every demo's status.

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

Tests: `npm test` in `superdemo/frontend/`, `uv run pytest` in `superdemo/backend/`, and `bash superdemo/deploy/lib.test.sh` for the bash helpers.
