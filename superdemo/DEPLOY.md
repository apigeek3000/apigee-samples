# Deploy the Superdemo to Cloud Run

**Optional.** This hosts the Superdemo web app (FastAPI backend + React SPA) on
Cloud Run, gated by **Firebase Google sign-in** and a configurable access
allowlist. If you only want to run the app locally, you don't need any of this —
see [SETUP.md](SETUP.md). For an overview of the app, see
[README.md](README.md).

Authentication is **enforced only when deployed** (the backend auto-detects
Cloud Run, and this deploy also sets the toggle explicitly). Local development
runs without sign-in by default — see *How the auth toggle works* below.

## Prerequisites

1. Complete [SETUP.md](SETUP.md) first — the app's backend reads the
   `superdemo-config` secret that [`deploy-superdemo.sh`](deploy/deploy-superdemo.sh)
   writes. This deploy must run **after** that one.
2. [gcloud CLI](https://cloud.google.com/sdk/docs/install), authenticated, with
   the active project set (see SETUP.md → *Authenticate and set the active
   project*).
3. Your `secret.sh` sourced in the current shell:
   ```bash
   source ./superdemo/deploy/secret.sh
   ```

## Configure authentication (Firebase)

Do this one-time setup in the same GCP project, then fill the values into
`secret.sh`:

1. Open the [Firebase Console](https://console.firebase.google.com/), add your
   GCP project (or select it if already added).
2. **Authentication → Get started → Sign-in method →** enable **Google**.
3. **Project settings → Your apps → Web app (`</>`)** → register an app. Copy
   the config values into `secret.sh`:
   - `apiKey` → `FIREBASE_API_KEY`
   - `authDomain` → `FIREBASE_AUTH_DOMAIN`
   - `projectId` → `FIREBASE_PROJECT_ID`
   - `appId` → `FIREBASE_APP_ID`
4. Set the allowlist in `secret.sh`: `ALLOWED_DOMAINS` (e.g.
   `example.com,other.com`) and/or `ALLOWED_EMAILS` (e.g.
   `alice@gmail.com,bob@gmail.com`). Both are comma-separated and either may be
   empty. A sign-in is allowed when the email's **domain** is in
   `ALLOWED_DOMAINS` **or** its **exact address** is in `ALLOWED_EMAILS`. If
   **both are empty, all sign-ins are denied** (fail-closed).
5. Deploy the app (below). After the **first** frontend deploy, copy the printed
   Cloud Run frontend URL into **Firebase Console → Authentication → Settings →
   Authorized domains**, then reload the app. The frontend URL will look something
   like this: superdemo-frontend-your-project-number.your-service-region.run.app

## Deploy the app

```bash
./superdemo/deploy/deploy-superdemo-app.sh
```

This deploys two Cloud Run services — `superdemo-backend` (FastAPI) and
`superdemo-frontend` (the built SPA served by Caddy) — and prints a public URL
to open. Both are reachable on the network (`--allow-unauthenticated`), but the
backend enforces Firebase Google sign-in and the allowlist on every `/api/*`
request, so the Apigee API keys it holds are never exposed to unapproved users.
The frontend reverse-proxies `/api/*` to the backend, so the browser only ever
sees one origin (no CORS) — the production twin of the Vite dev proxy.

The deploy sets `AUTH_ENABLED=true` on the backend and bakes
`VITE_AUTH_ENABLED=true` plus the public `VITE_FIREBASE_*` config into the
frontend build, so auth is active automatically.

To tear down just the app services: `./superdemo/deploy/clean-superdemo-app.sh`.

## Updating the allowlist without redeploying the app

The allowlist lives entirely in the backend's `ALLOWED_DOMAINS` /
`ALLOWED_EMAILS` environment variables, and the backend re-reads them on every
request. To change who can sign in, you do **not** need to rebuild or re-run
`deploy-superdemo-app.sh` — just update the env vars on the existing
`superdemo-backend` service. Cloud Run rolls out a new revision in seconds
(same container image, no source rebuild):

```bash
# Replace the whole list (values may contain commas, so keep the ^|^ delimiter):
gcloud run services update superdemo-backend \
  --region "$REGION" --project "$PROJECT_ID" \
  --update-env-vars "^|^ALLOWED_DOMAINS=example.com,partner.com|ALLOWED_EMAILS=alice@gmail.com,bob@gmail.com"

# Update just one list:
gcloud run services update superdemo-backend \
  --region "$REGION" --project "$PROJECT_ID" \
  --update-env-vars "^|^ALLOWED_EMAILS=alice@gmail.com,carol@gmail.com"
```

The new revision serves the updated allowlist immediately; already-signed-in
users who are removed are denied on their next `/api/*` request. Keep
`secret.sh` in sync so the next full deploy doesn't revert your change. (The
`^|^` prefix tells `gcloud` to split `KEY=VALUE` pairs on `|` instead of `,`,
which is required because the allowlist values themselves contain commas.)

## How the auth toggle works

Auth is governed by `AUTH_ENABLED` (backend) and `VITE_AUTH_ENABLED` (frontend):

- **On Cloud Run** — this deploy sets both to `true`. Even if they were unset,
  the backend defaults auth **on** when it detects Cloud Run (the `K_SERVICE`
  env var that Cloud Run always injects).
- **Locally** — both default to **off**, so the dev loop needs no Firebase
  config and no sign-in.

### Testing authentication locally

Local dev has auth **off by default**, so you opt in on **both** sides — and the
two processes read *different* variables:

- **Backend** (FastAPI) reads `AUTH_ENABLED` from its process environment, plus
  `FIREBASE_PROJECT_ID` (falling back to `GOOGLE_CLOUD_PROJECT`) for token
  verification.
- **Frontend** (Vite) reads `VITE_AUTH_ENABLED` and the `VITE_FIREBASE_*` web
  config. Only `VITE_`-prefixed variables are exposed to the browser, so the
  backend's `AUTH_ENABLED` does **not** turn on the frontend gate.

The most common mistake is enabling one side only: with `AUTH_ENABLED=true` on
the backend but no `VITE_AUTH_ENABLED=true` on the frontend, the backend rejects
every `/api/*` call (`401`) while the SPA never renders a sign-in page — you
just see a "backend unreachable" error.

After completing the Firebase setup above:

1. **Backend** — source your secrets (which set `AUTH_ENABLED=true` and the
   `FIREBASE_*` values) and start it. Token verification uses Application
   Default Credentials, so run `gcloud auth application-default login` first if
   you haven't:
   ```bash
   cd superdemo/backend
   source ../deploy/secret.sh
   uv run uvicorn main:app --reload --port 8000
   ```

2. **Frontend** — copy the committed
   [`frontend/.env.example`](frontend/.env.example) to `frontend/.env`, fill in
   your Firebase web config, and start the dev server:
   ```bash
   cd superdemo/frontend
   cp .env.example .env
   # then edit .env with your VITE_FIREBASE_* values
   npm run dev
   ```
   `.env.example` already includes `VITE_AUTH_ENABLED=true` — the line that
   turns on the frontend sign-in gate. Vite reads env files only at startup, so
   restart `npm run dev` after editing `.env`.

3. Open http://localhost:5173 and sign in with an allowlisted Google account
   (`localhost` is a Firebase-authorized domain by default). A non-allowlisted
   account lands on the access-denied screen.

Local env files never affect a deployment: `frontend/.env`, `.env.example`, and
any `*.local` files are all excluded from the Cloud Build upload by
[`frontend/.gcloudignore`](frontend/.gcloudignore), and the deploy generates its
own `.env.production` (see *Deploy the app* above).
