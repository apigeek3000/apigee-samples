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

"""Firebase ID-token verification and email allowlist for the superdemo backend.

Auth is enforced when enabled (see `_auth_enabled`): on by default under Cloud
Run, off by default in local development. Tests bypass it via
`app.dependency_overrides[get_current_user]` (see conftest.py) — the real
verification path still ships and runs outside tests.
"""


def is_email_allowed(email: str, domains: set[str], emails: set[str]) -> bool:
    """True if `email` is on the allowlist.

    Allowed when the exact address is in `emails`, OR its domain is in
    `domains`. All comparisons are case-insensitive. Fail closed: an empty
    email, or both allowlists empty, denies.
    """
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return False
    if email in {e.strip().lower() for e in emails}:
        return True
    domain = email.rsplit("@", 1)[1]
    return domain in {d.strip().lower() for d in domains}


import os

import firebase_admin
from firebase_admin import auth as firebase_auth
from fastapi import HTTPException, Request

# Lazy Firebase app handle (matches the lazy-init pattern in main.py for the
# logging client / Vertex credentials). Importing this module has no side
# effects, so tests can import it without touching the network or ADC.
_firebase_app = None


def _ensure_firebase() -> None:
    """Initialise the firebase-admin app once, via ADC. Project id comes from
    FIREBASE_PROJECT_ID, falling back to GOOGLE_CLOUD_PROJECT."""
    global _firebase_app
    if _firebase_app is not None:
        return
    project_id = os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get(
        "GOOGLE_CLOUD_PROJECT"
    )
    options = {"projectId": project_id} if project_id else None
    _firebase_app = firebase_admin.initialize_app(options=options)


def _auth_enabled() -> bool:
    """Whether to enforce auth on this request.

    An explicit AUTH_ENABLED env var wins (truthy: 1/true/yes/on). Otherwise the
    default is on when running on Cloud Run — which always sets K_SERVICE — and
    off in local development, so the dev loop needs no Firebase config or
    sign-in.
    """
    explicit = os.environ.get("AUTH_ENABLED", "").strip()
    if explicit:
        return explicit.lower() in {"1", "true", "yes", "on"}
    return bool(os.environ.get("K_SERVICE"))


def _allowlist_from_env() -> tuple[set[str], set[str]]:
    domains = {
        d.strip() for d in os.environ.get("ALLOWED_DOMAINS", "").split(",") if d.strip()
    }
    emails = {
        e.strip() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()
    }
    return domains, emails


def get_current_user(request: Request) -> dict:
    """FastAPI dependency: verify the Firebase ID token and enforce the allowlist.

    401 — missing/malformed/invalid token. 403 — verified but unverified email
    or not on the allowlist. When auth is disabled (local dev by default), it
    short-circuits to a stub user without requiring a token.
    """
    if not _auth_enabled():
        return {"email": "local-dev@localhost", "uid": "local-dev"}

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header[len("bearer "):].strip()

    _ensure_firebase()
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:  # firebase raises several subclasses; treat all as 401
        raise HTTPException(status_code=401, detail="Invalid token") from e

    if not decoded.get("email_verified"):
        raise HTTPException(status_code=403, detail="Email not verified")

    email = decoded.get("email", "")
    domains, emails = _allowlist_from_env()
    if not is_email_allowed(email, domains, emails):
        raise HTTPException(status_code=403, detail="Not authorized")

    return {"email": email, "uid": decoded.get("uid", "")}
